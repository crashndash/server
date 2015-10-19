'use strict';
/**
 * Module import
 */

var http = require('http');
var util = require('util');
http.globalAgent.maxSockets = 25;

var bodyParser = require('body-parser');
var express = require('express');
var _ = require('underscore');
var toobusy = require('toobusy-js');
var redis = require('redis');

var models = require('./models');
var client = require('./src/db');
var deleteUser = require('./src/deleteUser');
var deleteEvents = require('./src/deleteEvents');
var newUser = require('./src/newUser');
var newGame = require('./src/newGame');
var generateLevel = require('./src/generateLevel');
var parseReward = require('./src/parseReward');
var logger = require('./src/logger');
var setUpRoutes = require('./src/setUpRoutes');
var config;

/**
 * Globals.
 */
var app = express();
app.setConfig = function(c) {
  config = c;
  app.port = config.port;
  app.namespace = config.namespace;
  app.secret = config.secret;
  app.masterhostname = config.masterhostname;
  app.masterport = config.masterport;
  app.masterscheme = config.masterscheme;
  return this;
};

app.log = function(string, severity) {
  logger(string, severity);
};

app.use(function(req, res, next) {
  // Ok, this is something we have not started doing yet. Ignore in code
  // coverage.
  /* istanbul ignore next */
  if (toobusy()) {
    app.log(util.format('Busy sent at %d users', _.size(app.data.users)));
    next();
  } else {
    next();
  }
});

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
/* istanbul ignore next*/
function logErrors(err, req, res, next) {
  app.log('Error handler kicked in:');
  console.error(err.stack);
  next(err);
}
/* istanbul ignore next*/
function clientErrorHandler(err, req, res, next) {
  app.log('Client error handler');
  app.log(err);
  res.send(500, { error: 'Something blew up!' });
  next(err);
}
app.use(logErrors);
app.use(clientErrorHandler);
app.disable('x-powered-by');
app.polltime = 50000;
app.loopInterval = 400;
app.cronInterval = 20000;
app.data = {
  events: {},
  games: {},
  users: {},
  loners: {},
  rewards: {},
  recruiters: {}
};

app.version = 1.6;
app.numsegments = 107;
app.userModel = models.user;
app.eventModel = models.event;

app.redisOptions = {
  port: 6379,
  host: process.env.REDIS_ENV || 'localhost'
};

var pubclient = redis.createClient(app.redisOptions.port, app.redisOptions.host);
app.pubclient = pubclient;
var subclient1 = redis.createClient(app.redisOptions.port, app.redisOptions.host);
var subclient2 = redis.createClient(app.redisOptions.port, app.redisOptions.host);


/**
 * Catch redis errors.
 */
/* istanbul ignore next*/
subclient1.on('error', function(err) {
  app.log('Error ' + err + ' on sub1');
});
/* istanbul ignore next*/
subclient2.on('error', function(err) {
  app.log('Error ' + err + ' on sub2');
});
/* istanbul ignore next*/
pubclient.on('error', function(err) {
  app.log('Error ' + err + ' on pub');
});

var addEvent = require('./src/addEvent')(app);

var addRoomSummary = function(room) {
  // Poor mans lock system.
  if (app.data.games[room].summary) {
    return;
  }
  app.data.games[room].summary = true;
  // Only the master server sends summaries.
  /* istanbul ignore next */
  if (process.env.NODE_ENV === 'slave') {
    deleteEvents(room, app.data);
    return;
  }
  // Increment random seed addition.
  client.hincrby(app.namespace + '.roomvars', 'room' + room, 1, function(err, res) {
    /* istanbul ignore if */
    if (err || !res) {
      // Must be the best error handling.
      res = 0;
    }
    var addition = parseInt(res, 10),
      // Add a summary event for the room.
      // We call the "from user" root, so that everyone gets it.
      user = 'root',
      type = 'summary',
      level = generateLevel(parseInt(room, 10) + addition),
      // Just sending raw data back, the client will have to calculate
      // for us.
      message = {
        results: app.data.games[room].events,
        level: level
      };

    // Add the event.
    addEvent(user, type, room, message, user);
    // Delete the events object in the room.
    deleteEvents(room, app.data);
  });
};

app.initSubClients = function() {
  subclient1.subscribe(app.namespace + '.events');
  subclient2.psubscribe(app.namespace + '.new*');
};

subclient1.on('message', function (channel, message) {
  var data = JSON.parse(message);
  var messages = false;

  // We don't react on summary and kick events.
  if (data.event.type !== 'summary' && data.event.type !== 'kick') {
    /* istanbul ignore next */
    app.data.games[data.room] = app.data.games[data.room] || {};
    /* istanbul ignore next */
    app.data.games[data.room].events = app.data.games[data.room].events || {};
    app.data.games[data.room].events[data.event.type] = app.data.games[data.room].events[data.event.type] || {};
    var name = data.event.fromname;
    var user = data.event.from;
    // Accept more than one event at a time, but still keep backwards
    // compability.
    /* istanbul ignore next */
    app.data.games[data.room].events[data.event.type][user] = app.data.games[data.room].events[data.event.type][user] || {};
    messages = data.event.message.split(',');
    var increment = messages.length,
      currentcount = app.data.games[data.room].events[data.event.type][user].count || 0,
      eventdata = {
        name: name,
        count: currentcount + increment
      };
    app.data.games[data.room].events[data.event.type][user] = eventdata;
    /* istanbul ignore next */
    app.data.games[data.room].events.car = app.data.games[data.room].events.car || {};
    if (!app.data.games[data.room].events.car[user]) {
      // If the user has no cars on him, add a 0, so people can see him.
      app.data.games[data.room].events.car[user] = {
        name: name,
        count: 0
      };
    }
    // If the message is about progress, then we want to store the message,
    // and not increment like above.
    if (data.event.type === 'progress') {
      // Set message as stats.
      app.data.games[data.room].events[data.event.type][user] = {
        name: name,
        count: parseInt(messages[0], 10)
      };
    }


    // Add summary if we have passed 100 segments. Make that 107, so the player
    // actually can experience crossing the line.
    var numsegments = app.numsegments;
    if (messages[0] >= numsegments && data.event.type === 'progress') {
      addRoomSummary(data.room);
    }
  }

  app.data.events[data.room] = app.data.events[data.room] || [];
  var len = 0;
  var i = 0;
  if (messages) {
    // If messages is an array at this point, we need to iterate and push each
    // message.
    for (len = messages.length; i < len; i++) {
      var event = _.clone(data.event);
      event.message = messages[i];
      app.data.events[data.room].push(event);
    }
  }
  else {
    app.data.events[data.room].push(data.event);
  }
  if (data.event.type === 'kick') {
    deleteUser(data, app);
    // And to be sure the async ghost does not add some events after we have
    // deleted, we do it again after 1s.
    setTimeout(function() {
      deleteUser(data, app);
    }, 1000);
  }
});

subclient2.on('pmessage', function(pattern, channel, message) {
  var data = JSON.parse(message);
  if (channel === app.namespace + '.newuser') {
    newUser(data, app);
    return;
  }
  if (channel === app.namespace + '.newgame') {
    newGame(data, app);
    return;
  }
  if (channel === app.namespace + '.newrewardmsg') {
    parseReward(data, app);
    return;
  }
});

app.startSlave = function(cb) {
  // Get status from master server.
  var httpR = require(app.masterscheme);
  var masterUrl = app.masterscheme + '://' + app.masterhostname + ':' + app.masterport + '/current-status?secret=' + app.secret;
  var r = httpR.get(masterUrl, function(res) {
    app.log('Got response ' + res.statusCode + ' from master server');
    res.setEncoding('utf8');
    var buffer = '';
    res.on('data', function (chunk) {
      buffer += chunk;
    });
    res.on('end', function() {
      var ext = JSON.parse(buffer);
      cb(null, ext);
    });
  });
  r.on('error', function(e) {
    app.log('Got error ' + e.message + ' from master server');
    cb(e.message);
  });
};

app.init = function() {
  app.initSubClients();
  setUpRoutes(app, config);
  var start = function() {
    app.listen(app.port);
    app.log('Server started on port ' + app.port, 'debug');
  };
  /* istanbul ignore next */
  if (process.env.NODE_ENV === 'slave') {
    app.startSlave(function(err, res) {
      if (err) {
        throw new Error(err);
      }
      app.data = res;
      start();
    });
  }
  else {
    start();
  }
};

module.exports = app;
