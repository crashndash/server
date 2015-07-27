'use strict';
/**
 * Module import
 */

var http = require('http');
var fs = require('fs');
var util = require('util');
var path = require('path');
http.globalAgent.maxSockets = 25;

var bodyParser = require('body-parser');
var express = require('express');
var _ = require('underscore');
var url = require('url');
var toobusy = require('toobusy-js');
var crypto = require('crypto');
var redis = require('redis');

var models = require('./models');
var helpers = require('./src/helpers');
var client = require('./src/db');
var deleteUser = require('./src/deleteUser');
var deleteEvents = require('./src/deleteEvents');
var newUser = require('./src/newUser');
var newGame = require('./src/newGame');
var generateLevel = require('./src/generateLevel');
var parseReward = require('./src/parseReward');
var logger = require('./src/logger');
var config;
var customHash;

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
var Event = app.eventModel;
var UserModel = app.userModel;

app.redisOptions = {
  port: 6379,
  host: process.env.REDIS_ENV || 'localhost'
};

var pubclient = redis.createClient(app.redisOptions.port, app.redisOptions.host);
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

var addEvent = function(user, type, room, message, name) {
  var event = new Event(user, type, message, name);
  event.publish(app, pubclient, room);
};

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

  if (data.event.type === 'summary' || data.event.type === 'kick') {
    // Skipping the logging of the summary or the kick.
  }
  else {
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

app.get('/users', function(req, res) {
  res.status(200).send(_.size(app.data.users) + "\n");
});

var userdata = function(req, res, next) {
  if (!req.get('X-User')) {
    // Woah. No header. Let's send old version response (most likely the case).
    res.status(418).send('');
    return;
  }
  var data = JSON.parse(req.get('X-User'));
  if (!data || !data.id || !data.name || !data.version) {
    res.status(400).send('');
    return;
  }
  req.userdata = data;
  next();
};

app.post('/game', userdata, function(req, res) {
  var u = url.parse(req.url, true);

  // Check if there is a game name.
  if (!u.query || !u.query.game) {
    res.status(400).send('');
    return;
  }

  var name = u.query.game,
    user = req.userdata.id,
    size = 1;

  if (app.data.games[name]) {
    if (_.size(app.data.games[name].users) > 3) {
      // The room has more than 3 users in it. This guy can not come in.

      // ... unless he already is one of them.
      if (!app.data.games[name].users[user]) {
        res.status(403).send('');
        return;
      }
    }
    // We can safely assume there will be size + 1 when this user joins.
    // If this does not hold up, the correct number will be sent on polling.
    // In any case, telling a user that he is alone in the room, when he is
    // not, would be the worst of these.
    size = _.size(app.data.games[name].users) + 1;
  }

  pubclient.publish(app.namespace + '.newgame', JSON.stringify([name, user]));
  // Get random seed addition.
  client.hget(app.namespace + '.roomvars', 'room' + name, function(err, result) {
    /* istanbul ignore next */
    if (err || !result) {
      result = 0;
    }
    var addition = parseInt(result, 10),
      total = parseInt(name, 10) + addition,
      level = generateLevel(total),

      response = {
        opponents: size,
        blocks: level.blocks,
        powerUps: level.powerUps
      };
    res.status(200).json(response);
  });
});

var hashprotected = function(req, res, next) {
  var count = req.get(config.headerControlNumber),
    hash = req.get(config.headerHash);
  // Not even possible.

  /* istanbul ignore next */
  if (!req.userdata) {
    res.send('', 400);
    return;
  }

  var user = req.userdata.id;
  var version = parseFloat(req.userdata.version);

  var usedHash = hash;
  var correctHash;
  /*istanbul ignore else*/
  if (config.customHash) {
    if (!customHash) {
      customHash = require('./' + config.customHash);
    }
    // If this now throws something, then that is prabably just as well.
    correctHash = customHash(user, version, count);
  }
  else {
    correctHash = crypto.createHash('md5')
    .update(user + version + count + config.secret)
    .digest('hex');
  }

  // Check if user is reusing hashes.
  if (app.data.users[user] && app.data.users[user].hash && app.data.users[user].hash === usedHash) {
    res.status(400).send('');
    return;
  }
  // Done for debugging:
  /* istanbul ignore next */
  if (app.debug) {
    console.log('--- DEBUG DATA ---');
    console.log('user id: ' + user);
    console.log('user version: ' + version);
    console.log('user count: ' + count);
    console.log('used hash: ' + usedHash);
    console.log('correct hash: ' + correctHash);
  }

  app.data.users[user] = app.data.users[user] || {};
  app.data.users[user].hash = usedHash;

  // Security to the maxxx.
  if (usedHash !== correctHash) {
    res.status(400).send('');
    return;
  }
  next();
};

app.get('/connect', userdata, hashprotected, function(req, res) {
  var user = req.userdata.id,
    name = req.userdata.name,
    version = parseFloat(req.userdata.version);

  if (version < app.version) {
    // The following lines implies that if the version is not the app version...
    // then this server is not a teapot.

    // Does that imply that if it matches, then the server is a teapot?
    res.status(418).send('');
    return;
  }

  var time = helpers.currentTimestamp();
  var sendUser = new UserModel(user, name, time);
  if (req.userdata.mail) {
    sendUser.mail = req.userdata.mail;
  }
  var ipAddress;
  var forwardedIpsStr = req.header('x-forwarded-for');
  /* istanbul ignore next */
  if (forwardedIpsStr) {
    // 'x-forwarded-for' header may return multiple IP addresses in
    // the format: "client IP, proxy 1 IP, proxy 2 IP" so take the
    // the first one
    var forwardedIps = forwardedIpsStr.split(',');
    ipAddress = forwardedIps[0];
  }
  /* istanbul ignore next */
  if (!ipAddress) {
    // Ensure getting client IP address still works in
    // development environment
    ipAddress = req.connection.remoteAddress;
  }
  sendUser.publish(app, pubclient);
  sendUser.connected(app, pubclient);
  var connectdata = {user: user, ip: ipAddress, timestamp: time};
  pubclient.publish(app.namespace + '.connect', JSON.stringify(connectdata));

  var room = false;
  var roomPlayers = 0;
  // Find a good room for the user.
  for (var prop in app.data.loners) {
    /* istanbul ignore else */
    if (app.data.loners.hasOwnProperty(prop)) {
      // We'll just use the first one.
      room = prop;
      roomPlayers = 1;
      break;
    }
  }
  if (room !== 0 && !room) {
    // If we have no room suggestions, find an active one.
    for (var game in app.data.games) {
      /* istanbul ignore next */
      if (_.size(app.data.games[game].users) > 3) {
        // Too big of a room.
      }
      else {
        /* istanbul ignore else */
        if (!isNaN(parseInt(game, 10))) {
          room = game;
          roomPlayers = _.size(app.data.games[game].users);
          break;
        }
      }
    }
    if (room !== 0 && !room) {
      // If we still have no suggestions, than the server is either empty (most
      // likely), or all the rooms are full. Let's just assign a random one.
      room = Math.floor((Math.random() * 100));
    }
  }
  var totalPlayers = _.size(app.data.users);

  var response = {
    timestamp: helpers.currentTimestamp(),
    goodroom: room,
    roomPlayers: roomPlayers,
    totalPlayers: totalPlayers,
    users: app.data.users
  };

  var rewards = 0;
  if (app.data.rewards.all) {
    // Oh my, guess everyone wins.
    rewards += app.data.rewards.all;
    // We use the amount of points as an ID. Remember that!
    response.allReward = app.data.rewards.all;
  }

  // Check if the user has a reward pending.
  if (app.data.rewards[user]) {
    rewards += app.data.rewards[user];
    // The reward is then deleted.
    var deleteMessage = JSON.stringify(['delete', user]);
    pubclient.publish(app.namespace + '.newrewardmsg', deleteMessage);
  }

  if (rewards > 0) {
    response.rewards = rewards;
  }

  res.status(200).json(response);
});

var tryAgain = function(time, user, room, res, timerequest) {
  var t = setTimeout(function() {
    if (time + app.polltime < helpers.currentTimestamp()) {
      // Time out the user, and make him poll again.
      /* istanbul ignore next */
      app.data.games[room] = app.data.games[room] || {};
      res.header('X-room', room);
      res.status(204).send('Try again');
      clearTimeout(t);
      return;
    }
    /* istanbul ignore next */
    if (app.data.events[room]) {
      var sendevents = [];
      var i = 0;
      var len;
      var delEvents = [];
      for (len = app.data.events[room].length; i < len; i++) {
        var n = app.data.events[room][i];
        if (n.timestamp < timerequest || n.from === user) {
          // Not interesting.
          // If this is getting old, let's throw it away. 10 seconds is enough.
          if (n.timestamp < timerequest - 10000) {
            // Flag for deleting.
            delEvents.push(i);
          }
          continue;
        }
        else {
          sendevents.push(n);
        }
      }
      if (delEvents.length > 0) {
        var d = 0;
        var a = 0;
        for (a = delEvents.length; d < a; d++) {
          // Delete all flagged events.
          app.data.events[room].splice(delEvents[d], 1);
        }
      }
      if (sendevents.length > 0) {
        /* istanbul ignore next */
        app.data.games[room] = app.data.games[room] || {};
        /* istanbul ignore next */
        app.data.games[room].events = app.data.games[room].events || {};
        // Flag as 0 if we have no stats to send (for example if this is the summary).
        /* istanbul ignore next */
        app.data.games[room].events.car = app.data.games[room].events.car || 0;
        var stats = app.data.games[room].events.car;
        var response = {
          'events': sendevents,
          'timestamp': helpers.currentTimestamp(),
          'users': _.size(app.data.games[room].users),
          'stats': stats,
          'progress': app.data.games[room].events.progress || {},
          'room': room
        };
        var msg = JSON.stringify(response);
        res.status(200).send(msg + "\n");
        clearTimeout(t);
        return;
      }
    }
    // No events. Try again.
    tryAgain(time, user, room, res, timerequest);
  }, app.loopInterval);
};

/**
 * @todo write better description. When decided.
 */
app.get('/poll', userdata, function(req, res) {
  /* istanbul ignore next */
  res.on('error', function(err) {
    app.log('Error!');
    app.log(err);
  });
  var u = url.parse(req.url, true);
  var time = helpers.currentTimestamp();

  if (!u.query || !u.query.room || !u.query.time) {
    res.status(400).send('');
    return;
  }

  var user = req.userdata.id,
    name = req.userdata.name,
    room = u.query.room,
    timerequest = u.query.time;
  /* istanbul ignore next */
  if (!app.data.games[room]) {
    app.data.games[room] = {};
  }
  /* istanbul ignore next */
  if (!app.data.games[room].users) {
    app.data.games[room].users = {};
  }
  /* istanbul ignore next */
  if (!app.data.games[room].events) {
    app.data.games[room].events = {};
  }
  /* istanbul ignore next */
  app.data.games[room].events.car = app.data.games[room].events.car || {};
  if (!app.data.games[room].users[user]) {
    if (_.size(app.data.games[room].users) > 4 || _.size(app.data.games[room].events.car) > 4) {
      addEvent('root', 'kick', room, 'Room is full', name);
      app.log('Kicking out ' + name);
    }
  }
  app.data.games[room].users[user] = app.data.games[room].users[user] || {};
  app.data.games[room].users[user].time = helpers.currentTimestamp();

  tryAgain(time, user, room, res, timerequest);
});

app.get('/current-status', function(req, res) {
  if (req.query.secret !== app.secret) {
    // Just return without telling the request anything.
    res.status(418).send('');
    return;
  }
  // Get the current status when booting up a slave server.
  res.status(200).json(app.data);
});

/**
 * POST handler for adding a new event for the user.
 * The room and the type parameters are required.
 */
app.post('/', userdata, hashprotected, function(req, res) {
  var u = url.parse(req.url, true);

  // Check for bad request.
  if (!u.query || !u.query.type || !u.query.room) {
    res.status(400).send('');
    return;
  }

  // Extract the parameters.
  var user = req.userdata.id,
    name = req.userdata.name,
    type = u.query.type,
    room = u.query.room,
    message = u.query.message || '';

  // Add the event.
  addEvent(user, type, room, message, name);

  // Publish as new user, since this will update the timestamp.
  var time = helpers.currentTimestamp();
  var sendUser = new UserModel(user, name, time);
  if (req.userdata.mail) {
    sendUser.mail = req.userdata.mail;
  }
  sendUser.room = room;
  sendUser.publish(app, pubclient);

  // Send back 200 OK, and the car events in the room.
  app.data.games[room] = app.data.games[room] || {};
  app.data.games[room].events = app.data.games[room].events || {};
  app.data.games[room].events.car = app.data.games[room].events.car || {};
  res.status(200).json(app.data.games[room].events.car);
});

/**
 * POST Handler for posting stats.
 */
app.post('/stats', userdata, hashprotected, function(req, res) {
  if (req.body.config) {
    pubclient.publish(app.namespace + '.stats', JSON.stringify(req.body.config));
  }
  if (req.query && req.query.referrer) {
    // A recruiter. Let's reward this dude. Unless he already has recruited this
    // guy before.
    app.data.recruiters[req.query.referrer] = app.data.recruiters[req.query.referrer] || {};
    if (!app.data.recruiters[req.query.referrer][req.userdata.id]) {
      app.data.recruiters[req.query.referrer][req.userdata.id] = true;
      var message = [
        'new',
        req.query.referrer,
        100000
      ];
      pubclient.publish(app.namespace + '.newrewardmsg', JSON.stringify(message));
    }
  }
  client.hget(app.namespace + '.userstats_car', req.userdata.id, function(err, data) {
    /* istanbul ignore if */
    if (err) {
      data = 0;
    }
    res.header('X-opponents', _.size(app.data.users));
    res.header('X-crashes', data);
    res.status(204).send("");
  });
});

/**
 * POST Handler for posting high scores.
 */
app.post('/score', userdata, hashprotected, function(req, res) {
  /* istanbul ignore else */
  if (req.body.score) {
    // Check if md5 check is a-ok.
    var correctHash = crypto.createHash('md5')
      .update(req.body.score + 'burn rubber, burn!').digest('hex');
    if (req.body.check === correctHash) {
      pubclient.publish(app.namespace + '.scores', JSON.stringify(req.body));
      res.status(200).send("Thanks for the scores");
      return;
    }
  }
  res.status(410).send('');
});

/**
 * POST handler for all kinds of logging.
 */
app.post('/messages', userdata, hashprotected, function(req, res) {
  if (req.body && req.body.message) {
    // Write to a file.
    var time = Date.now();
    var filename = path.join(__dirname, 'messages', req.userdata.id + '-' + time + '.json');
    var data = JSON.stringify(req.body);
    fs.writeFile(filename, data, function(err) {
      /* istanbul ignore if*/
      if (err) {
        app.log(util.format('Error at writing file from message. Error was: %s', err));
        res.status(500).send('');
        return;
      }
      app.log(util.format('Saved a new message at %s', filename));
      res.set('X-timestamp', time);
      res.status(200).send('');
    });
    return;
  }
  res.status(400).send('');
});

app.startSlave = function(cb) {
  // Get status from master server.
  var httpR = require(app.masterscheme);
  var masterUrl = app.masterscheme + '://' + app.masterhostname + ':' + app.masterport + '/current-status?secret=' + app.secret;
  var r = httpR.get(masterUrl, function(res) {
    app.log("Got response " + res.statusCode + ' from master server');
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
    app.log("Got error " + e.message + ' from master server');
    cb(e.message);
  });
};

app.init = function() {
  app.initSubClients();
  var start = function() {
    app.listen(app.port);
    app.log("Server started on port " + app.port, 'debug');
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
