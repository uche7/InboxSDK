/* @flow */
//jshint ignore:start

var checkDependencies = require('./src/build/check-dependencies');

checkDependencies(require('./package'+'.json'));

var _ = require('lodash');
var gulp = require('gulp');
var destAtomic = require('gulp-dest-atomic');
var browserify = require('browserify');
var watchify = require('watchify');
var source = require('vinyl-source-stream');
var streamify = require('gulp-streamify');
var gulpif = require('gulp-if');
var uglify = require('gulp-uglify');
var sourcemaps = require('gulp-sourcemaps');
var stdio = require('stdio');
var gutil = require('gulp-util');
var rename = require("gulp-rename");
import extReloader from './live/ext-reloader';
var rimraf = require('rimraf');
var Kefir = require('kefir');
var RSVP = require('rsvp');
var globp = RSVP.denodeify(require('glob'));
import streamToPromise from './src/common/stream-to-promise';
var envify = require('envify/custom');
import exec from './src/build/exec';
import spawn from './src/build/spawn';
import escapeShellArg from './src/build/escape-shell-arg';
var fs = require('fs');
var dir = require('node-dir');
var babelify = require("babelify");
var lazyPipe = require('lazypipe');
var concat = require('gulp-concat');
var addsrc = require('gulp-add-src');

var sdkFilename = 'inboxsdk.js';

var args = stdio.getopt({
  'watch': {key: 'w', description: 'Automatic rebuild'},
  'reloader': {key: 'r', description: 'Automatic extension reloader'},
  'hot': {key: 'h', description: 'hot module replacement'},
  'single': {key: 's', description: 'Single bundle build (for development)'},
  'minify': {key: 'm', description: 'Minify build'},
  'production': {key: 'p', description: 'Production build'},
  'copy': {key: 'c', description: 'Also copy to Streak'}
});

// Don't let production be built without minification.
// Could just make the production flag imply the minify flag, but that seems
// like it would harm discoverability.
if (args.production && !args.minify) {
  throw new Error("--production requires --minify");
}

// --watch causes Browserify to use full paths in module references. We don't
// want those visible in production.
if (args.production && (args.watch || args.single)) {
  throw new Error("--production can not be used with --watch or --single");
}

function setupExamples() {
  // Copy inboxsdk.js (and .map) to all subdirs under examples/
  return globp('./examples/*/').then(function(dirs){
    if(args.copy){
      dirs.push('../MailFoo/extensions/devBuilds/chrome/');
    }
    return dirs;
  }).then(function(dirs) {
    return dirs.reduce(
      function(stream, dir) {
        return stream.pipe(destAtomic(dir));
      },
      gulp.src('./dist/'+sdkFilename)
        .pipe(rename('inboxsdk.js'))
    );
  }).then(streamToPromise).then(function() {
    if (args.reloader) {
      return extReloader();
    }
  });
}

gulp.task('noop', _.noop);

function getVersion(): Promise<string> {
  return RSVP.Promise.all([
    exec('git rev-list HEAD --max-count=1'),
    exec('git status --porcelain')
  ]).then(function(results) {
    var commit = results[0].toString().trim().slice(0, 16);
    var isModified = /^\s*M/m.test(results[1].toString());

    var version = `${require('./package'+'.json').version}-${Date.now()}-${commit}`;
    if (isModified) {
      version += '-MODIFIED';
    }
    if (args.watch) {
      version += '-WATCH';
    }
    return version;
  });
}

function browserifyTask(name, deps, entry, destname) {
  var willMinify = args.minify && (args.single || name !== "sdk");

  gulp.task(name, deps, async function() {
    var VERSION = await getVersion();
    var bundler = browserify({
      entries: entry,
      debug: true,
      cache: {}, packageCache: {}, fullPaths: args.watch
    }).transform(babelify).transform(envify({
      NODE_ENV: args.production ? 'production' : 'development',
      IMPLEMENTATION_URL: args.production ?
        'https://www.inboxsdk.com/build/platform-implementation.js' :
        'http://localhost:4567/platform-implementation.js',
      VERSION
    }));

    if (args.hot && name === (args.single ? 'sdk' : 'imp')) {
      bundler.plugin(require('browserify-hmr'));
    }

    function buildBundle() {
      var sourcemapPipeline = lazyPipe()
        .pipe(addsrc.prepend, (willMinify || args.production) ? ["./src/inboxsdk-js/header.js"] : [])
        .pipe(sourcemaps.init, {loadMaps: true})
        .pipe(concat, destname)
        .pipe(() => gulpif(willMinify, uglify({preserveComments: 'some'})))
        .pipe(sourcemaps.write, args.production ? '.' : null, {
          // don't include sourcemap comment in the inboxsdk.js file that we
          // distribute to developers since it'd always be broken.
          addComment: !args.production || name != 'sdk',
          sourceMappingURLPrefix: name == 'injected' ?
            'https://www.inboxsdk.com/build/' : null
        });

      var bundle = bundler.bundle();
      var result = bundle
        .pipe(source(destname))
        .pipe(gulpif(willMinify || args.production, streamify(sourcemapPipeline())))
        .pipe(destAtomic('./dist/'));

      return new RSVP.Promise(function(resolve, reject) {
        var errCb = _.once(function(err) {
          reject(err);
          result.end();
        });
        bundle.on('error', errCb);
        result.on('error', errCb);
        result.on('finish', resolve);
      });
    }

    if (args.watch) {
      bundler = watchify(bundler);
      Kefir
        .fromEvents(bundler, 'update')
        .throttle(10)
        .onValue(function() {
          gutil.log("Rebuilding '"+gutil.colors.cyan(name)+"'");
          buildBundle().then(function() {
            if (name === 'sdk') {
              return setupExamples();
            }
          }).then(function() {
            gutil.log("Finished rebuild of '"+gutil.colors.cyan(name)+"'");
          }, function(err) {
            gutil.log(
              gutil.colors.red("Error")+" rebuilding '"+
              gutil.colors.cyan(name)+"':", err.message
            );
          });
        });
    }

    return buildBundle();
  });
}

if (args.single) {
  gulp.task('default', ['sdk', 'examples']);
  browserifyTask('sdk', ['injected'], './src/inboxsdk-js/main-DEV.js', sdkFilename);
  gulp.task('imp', function() {
    throw new Error("No separate imp bundle in single bundle mode");
  });
} else {
  gulp.task('default', ['sdk', 'imp', 'examples']);
  browserifyTask('sdk', [], './src/inboxsdk-js/main.js', sdkFilename);
  browserifyTask('imp', ['injected'],
    './src/platform-implementation-js/main.js', 'platform-implementation.js');
}

browserifyTask('injected', [], './src/injected-js/main.js', 'injected.js');

gulp.task('examples', ['sdk'], setupExamples);

gulp.task('server', [args.single ? 'sdk' : 'imp'], function() {
  return require('./live/app').run();
});

gulp.task('clean', function(cb) {
  rimraf('./dist/', cb);
});

gulp.task('test', ['test-unit', 'test-jsdom']);

gulp.task('test-unit', function() {
  return spawn('node_modules/.bin/mocha');
});

gulp.task('test-jsdom', [
  'test-jsdom-inboxsdk-gmail',
  'test-jsdom-inboxsdk-inbox',
  'test-jsdom-iti'
]);

gulp.task('test-jsdom-inboxsdk-gmail', function() {
  return spawn('node', ['-e', 'require("babel/register-without-polyfill"); require("./test/jsdom/inboxsdk-gmail.js");']);
});

gulp.task('test-jsdom-inboxsdk-inbox', function() {
  return spawn('node', ['-e', 'require("babel/register-without-polyfill"); require("./test/jsdom/inboxsdk-inbox.js");']);
});

gulp.task('test-jsdom-iti', function() {
  return spawn('node', ['-e', 'require("babel/register-without-polyfill"); require("./test/jsdom/injected-thread-identifier.js");']);
});

gulp.task('docs', function(cb) {
  dir.paths(__dirname + '/src', function(err, paths) {
    if (err) throw err;

    Promise.all(_.chain(paths.files)
      .filter(isFileEligbleForDocs)
      .map(logFiles)
      .map(parseCommentsInFile)
      .value()
    ).then(files => {
      var classes = _.chain(files)
        .filter(Boolean)
        .pluck('classes')
        .flatten(true)
        .filter(isNonEmptyClass)
        .map(transformClass)
        .forEach(checkForDocIssues)
        .value();

      var docsJson = {
        classes: _.chain(classes)
          .map(function(ele) {
            return [ele.name, ele];
          })
          .object()
          .value()
      };

      fs.writeFile('dist/docs.json', JSON.stringify(docsJson, null, 2), cb);
    }).catch(err => cb(err));
  });

});

function checkForDocIssues(c) {
  if (c.functions) {
    c.functions.forEach(function(func){
      if (!func.returns) {
        console.error("WARNING: " + func.name + " in " + c.name + " doesn't have a return tag");
      }
    });
  }

}

function parseCommentsInFile(file) {
  gutil.log("Parsing: " + gutil.colors.cyan(file));
  return exec('node_modules/.bin/jsdoc ' + escapeShellArg(file) + ' -t templates/haruki -d console -q format=json', {passStdErr: true})
    .then(({stdout, stderr}) => {
      var filteredStderr = stderr.replace(/^WARNING:.*(ArrowFunctionExpression|TemplateLiteral|TemplateElement|ExportDeclaration|ImportSpecifier|ImportDeclaration).*\n?/gm, '');
      if (filteredStderr) {
        process.stderr.write(filteredStderr);
      }
      var comments = JSON.parse(stdout);
      comments['filename'] = file;
      return comments;
    }, err => {
      console.error(err);
      return null;
    });
}

function transformClass(c) {
  if (!c.properties) {
    return c;
  }

  c.properties.forEach(function(prop){
    var optionalMarker = '\n^optional';
    var defaultRegex = /\n\^default=(.*)/;

    prop.optional = false;
    if (prop.description.indexOf(optionalMarker) > -1) {
      prop.optional = true;
      prop.description = prop.description.replace(optionalMarker, '');
    }

    prop.description = prop.description.replace(defaultRegex, function(m, c) {
      prop.default = c;
      return '';
    });
  });

  return c;
}

function isNonEmptyClass(c) {
  // its going to have one property with the filename at minimum because we added it
  return c != null;
}

function logFiles(filename) {
  return filename;
}

function isFileEligbleForDocs(filename) {
  return  filename.endsWith(".js") &&
          filename.indexOf("src/platform-implementation-js/platform-implementation.js") == -1 &&
          filename.indexOf('views/compose-button-view.js') == -1 &&
          filename.indexOf('widgets/buttons/basic-button-view-controller.js') == -1 &&
          (
            filename.indexOf('src/platform-implementation-js/platform-implementation') > -1 ||
            filename.indexOf('src/platform-implementation-js/views') > -1 ||
            filename.indexOf('src/platform-implementation-js/widgets') > -1 ||
            filename.indexOf('src/common/constants') > -1 ||
            filename.indexOf('src/docs/') > -1 ||
            (filename.indexOf('src/inboxsdk-js/') > -1 && filename.indexOf('src/inboxsdk-js/loading') == -1)
          );
}

function endsWith(str, suffix) {
  return str.indexOf(suffix, str.length - suffix.length) !== -1;
}