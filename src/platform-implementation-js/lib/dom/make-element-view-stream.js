var Bacon = require('baconjs');
var Map = require('es6-unweak-collections').Map;

// Built to be able to take a stream from makeElementChildStream(). This doesn't
// call makeElementChildStream() here -- you can call that yourself so you can
// filter/map/merge that stream however you want before passing it here.
function makeElementViewStream(opts) {
  var elementStream = opts.elementStream;
  var viewFn = opts.viewFn;

  var knownViews = new Map();

  elementStream.onEnd(function() {
    knownViews.forEach(function(view, el) {
      view.destroy();
    });
  });

  return elementStream
    .map(function(event) {
      var view = knownViews.get(event.el);
      if (view && event.type === 'removed') {
        view.destroy();
        knownViews.delete(event.el);
      } else if (!view && event.type === 'added') {
        view = viewFn(event.el);
        knownViews.set(event.el, view);
        return view;
      }
    }).filter(function(view) {
      return !!view;
    });
}

module.exports = makeElementViewStream;
