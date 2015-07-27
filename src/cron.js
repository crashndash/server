'use strict';
var client = require('./db');
var _ = require('underscore');
var helpers = require('./helpers');
var logger = require('./logger');

/* istanbul ignore next */
client.on('error', function(err) {
  logger(err, 'error');
});

var cleanuptime = helpers.currentTimestamp();

function cleanUpInvalidUser(app, u) {
  var user = app.data.users[u];
  if (!user.time) {
    // No time? What are you doing here?
    for (var prop in app.data.users[u]) {
      if (app.data.users[u].hasOwnProperty(prop)) {
        delete app.data.users[u][prop];
      }
    }
    delete app.data.users[u];
  }
}

function cleanUpOldUser(app, u) {
  var user = app.data.users[u];
  if (user && user.time < cleanuptime) {
    client.srem('users', u);
    /* istanbul ignore else */
    if (user.room) {
      // Delete the user from his room as well. If he is registered there.
      /* istanbul ignore else */
      if (app.data.games && app.data.games[user.room] && app.data.games[user.room].users && app.data.games[user.room].users[u]) {
        delete app.data.games[user.room].users[u];
        for (var e in app.data.games[user.room].events) {
          if (app.data.games[user.room].events.hasOwnProperty(e)) {
            if (app.data.games[user.room].events[e][u] !== undefined) {
              delete app.data.games[user.room].events[e][u];
            }
          }
        }
      }
    }
    /* istanbul ignore else */
    if (app.data.users[u].hash) {
      delete app.data.users[u].hash;
    }
    delete app.data.users[u];
  }
}

function cleanUpAppUsers(app) {
  for (var u in app.data.users) {
    if (app.data.users.hasOwnProperty(u)) {
      cleanUpInvalidUser(app, u);
      cleanUpOldUser(app, u);
    }
  }
}

function cleanUpRedisUsers(app) {
  client.smembers('users', function(err, reply) {
    // Iterate over users connected.
    /* istanbul ignore next */
    if (!reply || err) {
      return;
    }
    var j = 0;
    var length;
    /* istanbul ignore next */
    for (length = reply.length; j < length; j++) {
      var rUser = reply[j];
      if (!app.data.users[rUser] || app.data.users[rUser].time < cleanuptime) {
        client.srem('users', rUser);
      }
    }
  });
}

function cleanUpOldEvents(app) {
  for (var r in app.data.events) {
    if (app.data.events.hasOwnProperty(r)) {
      // Iterate over all events in a room.
      var i = 0;
      var len;
      for (len = app.data.events[r].length; i < len; i++) {
        var event = app.data.events[r][i];
        if (event && event.timestamp && event.timestamp < cleanuptime) {
          // An old event! Let's just get rid of this.
          app.data.events[r].splice(i, 1);
          i = i - 1;
        }
      }
    }
  }
}

function cleanUpOldGames(app) {
  for (var g in app.data.games) {
    if (app.data.games.hasOwnProperty(g)) {
      for (var l in app.data.games[g].users) {
        if (app.data.games[g].users[l].time < cleanuptime) {
          delete app.data.games[g].users[l];
        }
      }
      if (_.size(app.data.games[g].users) < 1) {
        // This room has no users. Delete the room.
        delete app.data.games[g].events;
        delete app.data.games[g];
      }
    }
  }
}

function cleanUpOldLoners(app) {
  for (var lo in app.data.loners) {
    if (app.data.loners.hasOwnProperty(lo)) {
      var loner = app.data.loners[lo];
      if (loner < helpers.currentTimestamp() - 600000) {
        // Delete suggestions that are older than 10 minutes. Those poor bastards
        // are doomed to be forever alone.
        delete app.data.loners[lo];
      }
    }
  }
}

var tidyUp = function(app) {
  // Delete users that are more than 3 minutes old.
  cleanuptime = helpers.currentTimestamp() - 180000;
  cleanUpAppUsers(app);
  // Delete from redis also, if we don't have any information.
  cleanUpRedisUsers(app);

  // Delete old events (like 3 minutes old).
  cleanUpOldEvents(app);
  cleanUpOldGames(app);
  cleanUpOldLoners(app);
};

module.exports = tidyUp;
