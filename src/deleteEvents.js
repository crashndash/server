'use strict';
module.exports = function(room, data) {
  delete data.games[room].events;
  // And delete again in 2 seconds, just to be sure.
  setTimeout(function() {
    /* istanbul ignore else */
    if (data.games[room]) {
      delete data.games[room].events;
    }
    // Release lock.
    if (data.games[room].summary) {
      delete data.games[room].summary;
    }
  }, 2000);
};
