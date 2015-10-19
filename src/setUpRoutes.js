'use strict';
var url = require('url');
var crypto = require('crypto');
var fs = require('fs');
var util = require('util');
var path = require('path');
var _ = require('underscore');

var userdata = require('../middleware/userdata');
var client = require('./db');
var generateLevel = require('./generateLevel');
var helpers = require('./helpers');

module.exports = function(app, config) {
  var pubclient = app.pubclient;
  var hashprotected = require('../middleware/hashprotected').bind(null, config, app);
  var UserModel = app.userModel;
  var addEvent = require('./addEvent')(app);

  app.get('/users', function(req, res) {
    // Need to make sure it is a string, so we don't accidentally set the
    // status code.
    res.status(200).send(_.size(app.data.users) + '');
  });

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
        if (_.size(app.data.games[game].users) <= 3) {
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
          res.status(200).send(msg);
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
      res.status(204).send('');
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
        res.status(200).send('Thanks for the scores');
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
      var filename = path.join(__dirname, '..', 'messages', req.userdata.id + '-' + time + '.json');
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
};
