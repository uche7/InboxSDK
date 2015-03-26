import _ from 'lodash';
import Bacon from 'baconjs';
import RSVP from 'rsvp';
import GmailElementGetter from '../gmail-element-getter';
import * as GRP from '../gmail-response-processor';

const threadListHandlersToSearchStrings = new Map();

/*
Timeline of how a custom thread list works:

* App registers a custom list by calling sdk.Router.handleCustomListRoute(),
  which forwards the call to the driver where the route id and handler are
  saved.

<User eventually navigates to a custom list route>

* setup-route-view-driver-stream.js receives the hashchange event, recognizes
  that it matched a register custom list route id, and then calls this file's
  showCustomThreadList function instead of creating a RouteView.

* showCustomThreadList registers a bunch of listeners to respond at the right
  times in the coming storm.

* showCustomThreadList hides the text in the search box, so the nonsense search
  isn't visible to the user.

* showCustomThreadList sets it all in motion by navigating the user to a search
  for a random string.

<Gmail thinks the user has navigated to a search, and triggers an AJAX request
for the search>

* We intercept the search request before it goes out, call the handler function
  the app gave us to figure out the RFC message IDs the app wants to show, and
  then rewrite the search request to be a search for those specific messages.

* We let the request through, and then look up all of the gmail thread ids for
  the requested messages.

<The server sends the browser the AJAX response back>

* We intercept the response, and reorder the messages in the response into the
  order that the app wants.

<Gmail gets our rewritten AJAX response, and switches the DOM to the search
 results>

* When the search completes and Gmail switches to the search results,
  setup-route-view-driver-stream.js recognizes the search string in the URL,
  and associates the new RouteView with the custom list.

* showCustomThreadList clears the search box and unhides the search box text so
  that it works again.

* showCustomThreadList changes the hash in the URL from the search back to the
  custom list route id (and fights gmail for a few milliseconds to keep that
  hash in the url).

*/

function findIdFailure(id, err) {
  console.log("Failed to find id for thread", id, err);
  return null;
}

// Returns the search string that will trigger the onActivate function.
function setupSearchReplacing(driver, customRouteID, onActivate) {
  const preexistingQuery = threadListHandlersToSearchStrings.get(onActivate);
  if (preexistingQuery) {
    return preexistingQuery;
  }
  let start;
  const newQuery = Date.now()+'-'+Math.random();
  driver.getPageCommunicator().setupCustomListResultsQuery(newQuery);
  driver.getPageCommunicator().ajaxInterceptStream
    .filter(e =>
      e.type === 'searchForReplacement' &&
      e.query === newQuery
    )
    .flatMap(e => {
      start = e.start;
      try {
        return Bacon.fromPromise(RSVP.Promise.resolve(onActivate(e.start)), true);
      } catch(e) {
        return new Bacon.Error(e);
      }
    })
    .flatMap(ids =>
      Array.isArray(ids) ?
        Bacon.once(ids) :
        new Bacon.Error(new Error("handleCustomListRoute result must be an array"))
    )
    .mapError(e => {
      driver.getLogger().error(e);
      return [];
    })
    .map(ids => _.map(ids, id => {
      if (typeof id === 'string') {
        if (id[0] == '<') {
          return {rfcId: id};
        } else {
          return {gtid: id};
        }
      } else if (id) {
        const obj = {
          gtid: typeof id.gtid === 'string' && id.gtid,
          rfcId: typeof id.rfcId === 'string' && id.rfcId
        };
        if (obj.gtid || obj.rfcId) {
          return obj;
        }
      }
    }))
    .map(_.compact)
    // Figure out any rfc ids we don't know yet
    .map(idPairs => RSVP.Promise.all(idPairs.map(pair =>
      pair.rfcId ? pair :
      driver.getMessageIdManager().getRfcMessageIdForGmailThreadId(pair.gtid)
        .then(rfcId => ({gtid: pair.gtid, rfcId}), findIdFailure.bind(null, pair.gtid))
    )))
    .flatMap(Bacon.fromPromise)
    .map(_.compact)
    .onValue(idPairs => {
      const query = idPairs.length > 0 ?
        idPairs.map(({rfcId}) => 'rfc822msgid:'+rfcId).join(' OR ')
        : ''+Math.random()+Date.now(); // google doesn't like empty searches
      driver.getPageCommunicator().setCustomListNewQuery(newQuery, query);
      Bacon.combineAsArray([
        // Figure out any gmail thread ids we don't know yet
        Bacon.fromPromise(RSVP.Promise.all(idPairs.map(pair =>
          pair.gtid ? pair :
          driver.getMessageIdManager().getGmailThreadIdForRfcMessageId(pair.rfcId)
            .then(gtid => ({gtid, rfcId: pair.rfcId}), findIdFailure.bind(null, pair.rfcId))
        ))).map(_.compact),

        driver.getPageCommunicator().ajaxInterceptStream
          .filter(e =>
            e.type === 'searchResultsResponse' &&
            e.query === newQuery && e.start === start
          )
          .map('.response')
          .take(1)
      ]).onValue(([idPairs, response]) => {
        const extractedThreads = GRP.extractThreads(response);
        const newThreads = _.chain(idPairs)
          .map(({gtid}) => _.find(extractedThreads, t => t.gmailThreadId === gtid))
          .compact()
          .value();
        const newResponse = GRP.replaceThreadsInResponse(response, newThreads);
        driver.getPageCommunicator().setCustomListResults(newQuery, newResponse);
      });
    });

  driver.getCustomListSearchStringsToRouteIds().set(newQuery, customRouteID);
  threadListHandlersToSearchStrings.set(onActivate, newQuery);
  return newQuery;
}

export default function showCustomThreadList(driver, customRouteID, onActivate) {
  const uniqueSearch = setupSearchReplacing(driver, customRouteID, onActivate);
  const customHash = document.location.hash;

  const nextMainContentElementChange = GmailElementGetter.getMainContentElementChangedStream().changes().take(1);

  const searchHash = '#search/'+encodeURIComponent(uniqueSearch);

  Bacon.fromEvent(window, 'hashchange')
    .filter(event => !event.oldURL.match(/#inboxsdk-fake-no-vc$/))
    .skipUntil(
      nextMainContentElementChange
    )
    .takeUntil(
      nextMainContentElementChange.delay(10)
    )
    .merge(nextMainContentElementChange)
    .filter(() => document.location.hash === searchHash)
    .onValue(() => {
      driver.hashChangeNoViewChange(customHash);
    });

  const searchInput = GmailElementGetter.getSearchInput();
  searchInput.value = '';
  searchInput.style.visibility = 'hidden';
  nextMainContentElementChange.onValue(() => {
    searchInput.value = '';
    searchInput.style.visibility = 'visible';
  });

  window.history.replaceState(null, null, searchHash);
  const hce = new HashChangeEvent('hashchange', {
    oldURL: document.location.href.replace(/#.*$/, '')+customHash,
    newURL: document.location.href.replace(/#.*$/, '')+searchHash
  });
  window.dispatchEvent(hce);
}