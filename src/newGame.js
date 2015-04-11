'use strict';
var helpers = require('./helpers');

module.exports = function(data, app) {
  // If the game does not exist, create it.
  if (!app.data.games[data[0]]) {
    app.data.games[data[0]] = {};
    // A newly created room, that means there are no users. Let's mark this as
    // a "loner" room.
    app.data.loners[data[0]] = helpers.currentTimestamp();
  }
  else {
    // This already has users, let's delete it from "loners" rooms, if it
    // exists.
    if (app.data.loners[data[0]]) {
      delete app.data.loners[data[0]];
    }
  }
  // If the game does not have any users, create the users array.
  app.data.games[data[0]].users = app.data.games[data[0]].users || {};
  // Push this user in the mix.
  app.data.games[data[0]].users[data[1]] = app.data.games[data[0]].users[data[1]] || {};
  app.data.games[data[0]].users[data[1]].time = helpers.currentTimestamp();
};
