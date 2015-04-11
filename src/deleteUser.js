module.exports = function(data, app) {
  'use strict';
  var id;
  for (var e in app.data.games[data.room].events) {
    /* istanbul ignore else */
    if (app.data.games[data.room].events.hasOwnProperty(e)) {
      for (var u in app.data.games[data.room].events[e]) {
        /* istanbul ignore else */
        if (app.data.games[data.room].events[e][u].name === data.event.fromname) {
          id = u;
          delete app.data.games[data.room].events[e][u];
        }
      }
    }
  }
  if (id) {
    delete app.data.games[data.room].users[id];
  }
};
