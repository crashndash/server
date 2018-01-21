'use strict';
var crypto = require('crypto');
var should = require('should');
var redis = require('redis');
var request = require('supertest');
var fs = require('fs');

let { app } = require('./helpers');
const { Testuser, Hash } = require('./helpers');

var client = require('../src/db');
var helpers = require('../src/helpers');
var config = require('../config');
app.setConfig(config);

app.polltime = 4000;
app.port = 4000;
app.namespace = 'rubber-test';
app.init();
app.on('error', function(e) {
  console.log(e.trace);
});

describe('Connect', function() {

  it('GET /connect should return 418 without user headers', function(done) {
    request(app)
      .get('/connect')
      .expect(418)
      .end(function(err) {
        done(err);
      });
  });

  it('GET /connect should return 418 with wrong version', function(done) {
    var user = new Testuser();
    user.version = app.version - (0.1);
    var hash = new Hash(user);
    request(app)
      .get('/connect')
      .set('X-User', user.j())
      .set(config.headerHash, hash.h())
      .set(config.headerControlNumber, hash.number)
      .expect(418)
      .end(function(err) {
        done(err);
      });
  });

  it('GET /connect should return 200 with correct params', function(done) {
    var user = new Testuser(),
      hash = new Hash(user);
    request(app)
      .get('/connect')
      .set('X-User', user.j())
      .set(config.headerHash, hash.hash)
      .set(config.headerControlNumber, hash.number)
      .end(function(err, res) {
        res.status.should.equal(200);
        done(err);
      });
  });

  it('GET /connect should return a default room', function(done) {
    var user = new Testuser(),
      hash = new Hash(user);
    request(app)
      .get('/connect')
      .set('X-User', user.j())
      .set(config.headerHash, hash.hash)
      .set(config.headerControlNumber, hash.number)
      .end(function(err, res) {
        var text = JSON.parse(res.text);
        text.should.have.property('goodroom');
        text.should.have.property('roomPlayers');
        text.should.have.property('totalPlayers');
        done(err);
      });
  });

  it('GET /connect should return a default room (when loners exist)', function(done) {
    var testroom = '123321',
      user = new Testuser(),
      hash = new Hash(user);
    request(app)
    .post('/game?game=' + testroom)
    .set('X-User', user.j())
    .set(config.headerHash, hash.hash)
    .set(config.headerControlNumber, hash.number)
    .end(function(err, res) {
      should(err).equal(null);
      res.status.should.equal(200);
      // Wait a little, so we are sure redis has published this to us.
      setTimeout(function() {
        // The room we created should be marked as loner.
        app.data.loners.should.have.property(testroom);
        user = new Testuser();
        hash = new Hash(user);
        request(app)
        .get('/connect')
        .set('X-User', user.j())
        .set(config.headerHash, hash.hash)
        .set(config.headerControlNumber, hash.number)
        .end(function(err2, res2) {
          should(err2).equal(null);
          var text = JSON.parse(res2.text);
          text.goodroom.should.equal(testroom);
          // The room we created should not be marked as loner anymore, if we
          // decide to join that room.
          request(app)
          .post('/game?user=user&game=' + testroom)
          .set('X-User', user.j())
          .set(config.headerHash, hash.hash)
          .set(config.headerControlNumber, hash.number)
          .end(function(err3) {
            setTimeout(function() {
              app.data.loners.should.not.have.property(testroom);
              done(err3);
            }, 500);
          });
        });
      }, 500);
    });
  });
});

describe('Game', function() {

  var testgame = 'testtest123' + helpers.currentTimestamp(),
    user = new Testuser(),
    hash = new Hash(user);

  it('POST /game should return 418 with old params', function(done) {
    request(app)
      .post('/game?user=eirik&game=' + testgame)
      .expect(418)
      .end(function(err) {
        done(err);
      });
  });

  it('POST /game should return 400 without game and user', function(done) {
    request(app)
    .post('/game')
    .set('X-User', user.j())
    .set(config.headerHash, hash.h())
    .set(config.headerControlNumber, hash.number)
    .expect(400)
    .end(function(err) {
      done(err);
    });
  });

  it('POST /game should return 200 with game and user', function(done) {
    request(app)
    .post('/game?game=' + testgame)
    .set('X-User', user.j())
    .set(config.headerHash, hash.h())
    .set(config.headerControlNumber, hash.number)
    .end(function(err, res) {
      res.status.should.equal(200);
      // The response should contain number of opponents.
      JSON.parse(res.text).opponents.should.equal(1);
      done(err);
    });
  });

  it('POST /game should always return the same "random" stuff', function(done) {
    client.hset(app.namespace + '.roomvars', 1, -1, function() {
      request(app)
      .post('/game?game=' + 1)
      .set('X-User', user.j())
      .set(config.headerHash, hash.h())
      .set(config.headerControlNumber, hash.number)
      .end(function(err2, res2) {
        res2.status.should.equal(200);
        // The response should be these arrays.
        var blocks = [ 86, 30, 53, 41, 3 ],
          powerUps = [ [ 21, 3 ],
            [ 61, 1 ],
            [ 54, 3 ],
            [ 61, 3 ],
            [ 28, 2 ],
            [ 66, 2 ],
            [ 96, 2 ],
            [ 13, 1 ],
            [ 79, 4 ],
            [ 85, 1 ],
            [ 82, 1 ],
            [ 68, 2 ],
            [ 6, 2 ],
            [ 41, 3 ],
            [ 45, 2 ]
          ],
          response = JSON.parse(res2.text);
        response.blocks.should.eql(blocks);
        response.powerUps.should.eql(powerUps);
        done(err2);
      });
    });
  });

  it('Should return 403 on POST /game when room is full', function(done) {
    testgame = 'testgame' + helpers.currentTimestamp();
    app.data.games[testgame] = {};
    app.data.games[testgame].users = {};
    app.data.games[testgame].users.testuser1 = new Testuser();
    app.data.games[testgame].users.testuser2 = new Testuser();
    app.data.games[testgame].users.testuser3 = new Testuser();
    app.data.games[testgame].users.testuser4 = new Testuser();
    request(app)
      .post('/game?game=' + testgame)
      .set('X-User', user.j())
      .set(config.headerHash, hash.h())
      .set(config.headerControlNumber, hash.number)
      .expect(403)
      .end(function(err) {
        done(err);
      });
  });

  it('POST /game should not return 403 when room is full and user is already in the room', function(done) {
    testgame = 'testgame' + helpers.currentTimestamp();
    var user2 = new Testuser();
    var hash2 = new Hash(user);
    app.data.games[testgame] = {};
    app.data.games[testgame].users = {};
    app.data.games[testgame].users.testuser1 = new Testuser();
    app.data.games[testgame].users.testuser2 = new Testuser();
    app.data.games[testgame].users.testuser3 = new Testuser();
    app.data.games[testgame].users[user.id] = new Testuser();
    request(app)
    .post('/game?game=' + testgame)
    .set('X-User', user2.j())
    .set(config.headerHash, hash2.h())
    .set(config.headerControlNumber, hash2.number)
    .expect(403)
    .end(function(err) {
      should(err).equal(null);
      request(app)
      .post('/game?game=' + testgame)
      .set('X-User', user.j())
      .set(config.headerHash, hash.h())
      .set(config.headerControlNumber, hash.number)
      .end(function(err2, res2) {
        res2.status.should.equal(200);
        done(err2);
      });
    });
  });
});

describe('Event', function() {

  var user = new Testuser();
  var hash = new Hash(user);

  it('Should return 418 without user header on POST event to /', function(done) {
    request(app)
    .post('/?room=eirik&message=&type=death')
    .expect(418)
    .end(function(err) {
      done(err);
    });
  });

  it('Should return 400 without all userdata info', function(done) {
    var user2 = new Testuser();
    var hash2 = new Hash(user2);
    delete user2.id;
    request(app)
    .post('/?room=eirik&messsage=&type=death')
    .set('X-User', user2.j())
    .set(config.headerHash, hash2.h())
    .set(config.headerControlNumber, hash2.number)
    .expect(400)
    .end(function(err) {
      done(err);
    });
  });

  it('Should return 400 with a wrong hash', function(done) {
    var user2 = new Testuser();
    var hash2 = new Hash(user2);
    request(app)
    .post('/?room=eirik&messsage=&type=death')
    .set('X-User', user2.j())
    .set(config.headerHash, hash2.h())
    .set(config.headerControlNumber, (hash2.number - 1))
    .expect(400)
    .end(function(err) {
      done(err);
    });
  });

  it('Should return 400 with same hash as last time', function(done) {
    var user2 = new Testuser();
    var hash2 = new Hash(user2);
    var testroom = 'testroomhash' + Math.floor(Math.random() * 200);
    request(app)
    .post('/?room=' + testroom + '&messsage=&type=death')
    .set('X-User', user2.j())
    .set(config.headerHash, hash2.h())
    .set(config.headerControlNumber, hash2.number)
    .end(function(err, res) {
      should(err).equal(null);
      res.status.should.equal(200);
      request(app)
      .post('/?room=' + testroom + '&messsage=&type=death')
      .set('X-User', user2.j())
      .set(config.headerHash, hash2.hash)
      .set(config.headerControlNumber, hash2.number)
      .expect(400)
      .end(function(err2) {
        done(err2);
      });
    });
  });

  it('POST event to / should return 400 without room', function(done) {
    request(app)
    .post('/?message=&type=death')
    .set('X-User', user.j())
    .set(config.headerHash, hash.h())
    .set(config.headerControlNumber, hash.number)
    .expect(400)
    .end(function(err) {
      done(err);
    });
  });

  it('Should return 400 without type on POST event', function(done) {
    request(app)
    .post('/?room=test&message=')
    .set('X-User', user.j())
    .set(config.headerHash, hash.h())
    .set(config.headerControlNumber, hash.number)
    .expect(400)
    .end(function(err) {
      done(err);
    });
  });

  it('Should return 200 on POST event to / with all params', function(done) {
    request(app)
    .post('/?room=eirik&message=&type=death')
    .set('X-User', user.j())
    .set(config.headerHash, hash.h())
    .set(config.headerControlNumber, hash.number)
    .end(function(err, res) {
      res.status.should.equal(200);
      done(err);
    });
  });

  it('Should contain the newly posted event', function(done) {
    app.data.events.eirik.should.have.lengthOf(1);
    app.data.events.eirik[0].should.have.property('type', 'death');
    done();
  });

  it('Should return a summary (but only one) when we win', function(done) {
    app.data.events.eirik = [];
    // Posting a winner event.
    request(app)
    .post('/?room=eirik&message=160&type=progress')
    .set('X-User', user.j())
    .set(config.headerHash, hash.h())
    .set(config.headerControlNumber, hash.number)
    .end(function(err) {
      should(err).equal(null);
      // Tossing in an extra winner event.
      request(app)
      .post('/?room=eirik&message=160&type=progress')
      .set('X-User', user.j())
      .set(config.headerHash, hash.h())
      .set(config.headerControlNumber, hash.number)
      .end(function(err2, res) {
        res.status.should.equal(200);
        setTimeout(function() {
          var summaries = 0;
          app.data.events.eirik.forEach(function(n) {
            if (n.type === 'summary') {
              summaries += 1;
            }
          });
          summaries.should.eql(1);
          done(err2);
        }, 200);
      });
    });
  });

  it('Should return a summary again after 2 more seconds', function(done) {
    this.timeout(3000);
    setTimeout(function() {
      request(app)
      .post('/?room=eirik&message=160&type=progress')
      .set('X-User', user.j())
      .set(config.headerHash, hash.h())
      .set(config.headerControlNumber, hash.number)
      .end(function(err, res) {
        res.status.should.equal(200);
        setTimeout(function() {
          var summaries = 0;
          app.data.events.eirik.forEach(function(n) {
            if (n.type === 'summary') {
              summaries += 1;
            }
          });
          // If we now have 2 summaries, the lock has been released, and a
          // summary is issued.
          summaries.should.eql(2);
          done(err);
        }, 200);
      });
    }, 2100);

  });

  it('Should happen stuff when we kick someone', function(done) {
    app.data.games.eirik = {};
    app.data.games.eirik.users = {};
    app.data.games.eirik.users[user.id] = {
      test: true
    };
    app.data.games.eirik.events = {};
    app.data.games.eirik.events.car = {};
    app.data.games.eirik.events.car[user.id] = {
      name: user.name,
      count: 123
    };
    var pubclient = redis.createClient(
      app.redisOptions.port,
      app.redisOptions.host
    );
    var Event = app.eventModel;
    var event = new Event('root', 'kick', 'sorry', user.name);
    event.publish(app, pubclient, 'eirik');
    setTimeout(function() {
      // Meh, random timeout to check if things went well.
      app.data.games.eirik.users.should.not.have.property(user.id);
      app.data.games.eirik.events.car.should.not.have.property(user.id);
      done();
    }, 200);
  });
});

describe('Get events', function(){
  // We are polling. Let's discard the timeout.
  this.timeout(1000000);

  var timestamp = helpers.currentTimestamp(),
    user = new Testuser(),
    user2 = new Testuser(),
    hash = new Hash(user),
    hash2 = new Hash(user2);

  before(function(done) {
    user.mail = 'test@test.com';
    request(app)
    .get('/connect')
    .set('X-User', user.j())
    .set(config.headerHash, hash.h())
    .set(config.headerControlNumber, hash.number)
    .end(function(err, res) {
      res.status.should.equal(200);
      done(err);
    });
  });

  before(function(done){
    request(app)
    .post('/?room=room&message=hallo&type=join')
    .set('X-User', user.j())
    .set(config.headerHash, hash.h())
    .set(config.headerControlNumber, hash.number)
    .end(function(err, res) {
      res.status.should.equal(200);
      done(err);
    });
  });

  it('Should send 400 when we are polling with some stupid parameters', function(done) {
    request(app)
    .get('/poll?room=room')
    .set('X-User', user2.j())
    .set(config.headerHash, hash2.h())
    .set(config.headerControlNumber, hash2.number)
    .expect(400)
    .end(function(err) {
      done(err);
    });
  });

  it('Should return a join event when polling', function(done) {
    request(app)
    .get('/poll?room=room&time=' + timestamp)
    .set('X-User', user2.j())
    .set(config.headerHash, hash2.h())
    .set(config.headerControlNumber, hash2.number)
    .end(function(err, res) {
      var a = JSON.parse(res.text);
      res.status.should.equal(200);
      // The response should contain number of opponents.
      a.should.have.property('users');
      a.events[0].should.have.property('message', 'hallo');
      a.events[0].should.have.property('type', 'join');
      done(err);
    });
  });

  it('Should not return anything if adjusting timestamp', function(done) {
    request(app)
    .get('/poll?room=room&time=' + helpers.currentTimestamp())
    .set('X-User', user2.j())
    .set(config.headerHash, hash2.h())
    .set(config.headerControlNumber, hash2.number)
    .end(function(err, res) {
      res.status.should.equal(204);
      done(err);
    });
  });

  it('Should not return anything if polling as the same user who sent the event', function(done) {
    request(app)
    .get('/poll?room=room&time=' + timestamp)
    .set('X-User', user.j())
    .set(config.headerHash, hash.h())
    .set(config.headerControlNumber, hash.number)
    .end(function(err, res) {
      res.status.should.equal(204);
      done(err);
    });
  });

  it('Should return multiple events if we send a comma separated car event.', function(done) {
    // Clear events first.
    app.data.events = {};
    request(app)
    .post('/?room=room&message=fatcar,bus&type=car')
    .set('X-User', user.j())
    .set(config.headerHash, hash.h())
    .set(config.headerControlNumber, hash.number)
    .end(function(err, res) {
      should(err).equal(null);
      res.status.should.equal(200);
      request(app)
      .get('/poll?room=room&time=' + timestamp)
      .set('X-User', user2.j())
      .set(config.headerHash, hash2.h())
      .set(config.headerControlNumber, hash2.number)
      .end(function(err2, res2) {
        var a = JSON.parse(res2.text);
        res2.status.should.equal(200);
        // The response should contain number of opponents.
        a.should.have.property('users');
        a.events.should.have.lengthOf(2);
        a.events[0].should.have.property('message', 'fatcar');
        a.events[0].should.have.property('type', 'car');
        a.events[1].should.have.property('message', 'bus');
        a.events[1].should.have.property('type', 'car');
        done(err2);
      });
    });
  });

  it('Should delete events that is older than 10 seconds.', function(done) {
    app.data.events.room.should.have.lengthOf(2);
    timestamp = helpers.currentTimestamp() + 15000;
    request(app)
    .get('/poll?room=room&time=' + timestamp)
    .set('X-User', user.j())
    .set(config.headerHash, hash2.h())
    .set(config.headerControlNumber, hash2.number)
    .end(function(err, res) {
      res.status.should.equal(204);
      app.data.events.room.should.have.lengthOf(0);
      done(err);
    });
  });

  it('Should kick out a person if he is polling in a full room', function(done) {
    var room = 'testkickroom' + Math.floor(Math.random() * 500);
    app.data.games[room] = {
      users: {
        user1: {},
        user2: {},
        user3: {},
        user4: {},
        user5: {}
      },
      events: {
        car: {
        }
      }
    };
    app.data.games[room].events.car[user.id] = {name: user.name, count: 123};
    request(app)
    .get('/poll?room=' + room + '&time=' + timestamp)
    .set('X-User', user.j())
    .set(config.headerHash, hash2.h())
    .set(config.headerControlNumber, hash2.number)
    .end(function(err) {
      setTimeout(function() {
        app.data.games[room].users.should.not.have.property(user.id);
        app.data.games[room].events.car.should.not.have.property(user.id);
        done(err);
      }, 1000);
    });
  });

});
describe('Rewards', function(){
  var pubclient;
  var user = new Testuser();
  var hash = new Hash(user);

  before(function(done){
    pubclient = redis.createClient(
      app.redisOptions.port,
      app.redisOptions.host
    );
    app.data.rewards = {};
    done();
  });


  it('Should not return rewards when we have no rewards', function(done) {
    request(app)
    .get('/connect')
    .set('X-User', user.j())
    .set(config.headerHash, hash.h())
    .set(config.headerControlNumber, hash.number)
    .end(function(err, res) {
      res.status.should.equal(200);
      var r = JSON.parse(res.text);
      r.should.not.have.property('rewards');
      r.should.not.have.property('allReward');
      done(err);
    });
  });

  it('Should return rewards when we publish one for ourselves', function(done) {
    pubclient.publish(app.namespace + '.newrewardmsg', JSON.stringify(['new', user.id, 200]), function() {
      request(app)
      .get('/connect')
      .set('X-User', user.j())
      .set(config.headerHash, hash.h())
      .set(config.headerControlNumber, hash.number)
      .end(function(err, res) {
        res.status.should.equal(200);
        var r = JSON.parse(res.text);
        r.should.have.property('rewards');
        r.should.not.have.property('allReward');
        r.rewards.should.equal(200);
        done(err);
      });
    });
  });

  it('Should delete the reward when we have collected it', function(done) {
    app.data.rewards.should.not.have.property('test');
    request(app)
    .get('/connect')
    .set('X-User', user.j())
    .set(config.headerHash, hash.h())
    .set(config.headerControlNumber, hash.number)
    .end(function(err, res) {
      res.status.should.equal(200);
      var r = JSON.parse(res.text);
      r.should.not.have.property('rewards');
      done(err);
    });
  });

  it('Should tell us that there is an all reward', function(done) {
    pubclient.publish(app.namespace + '.newrewardmsg', JSON.stringify(['new', 'all', 300]), function(e) {
      should(e).equal(null);
      request(app)
      .get('/connect')
      .set('X-User', user.j())
      .set(config.headerHash, hash.h())
      .set(config.headerControlNumber, hash.number)
      .end(function(err, res) {
        res.status.should.equal(200);
        var r = JSON.parse(res.text);
        r.should.have.property('rewards');
        r.should.have.property('allReward');
        r.rewards.should.equal(300);
        r.allReward.should.equal(300);
        done(err);
      });
    });
  });

  it('Should not have deleted the all reward', function(done) {
    app.data.rewards.should.have.property('all');
    done();
  });

});

describe('Stats posting', function() {
  it('Should tell us different kinds of things when we post stats', function(done) {
    var user = new Testuser();
    var hash = new Hash(user);
    request(app)
      .post('/stats')
      .send({config: {test: 'test'}})
      .set('X-User', user.j())
      .set(config.headerHash, hash.h())
      .set(config.headerControlNumber, hash.number)
      .end(function(err, res) {
        res.status.should.equal(204);
        res.header.should.have.property('x-crashes');
        res.header.should.have.property('x-opponents');
        done(err);
      });
  });

  var statsuser = new Testuser();
  var statshash = new Hash(statsuser);
  it('Should do something when we post stats with referrer', function(done) {
    request(app)
      .post('/stats?referrer=eirik')
      .set('X-User', statsuser.j())
      .set(config.headerHash, statshash.h())
      .set(config.headerControlNumber, statshash.number)
      .end(function(err, res) {
        res.status.should.equal(204);
        res.header.should.have.property('x-crashes');
        res.header.should.have.property('x-opponents');
        // Give the redis pub/sub some time.
        setTimeout(function() {
          app.data.recruiters.should.have.property('eirik');
          app.data.rewards.eirik.should.equal(100000);
          done(err);
        }, 50);
      });
  });

  it('Should not add another 100000 when the same person is referred', function(done) {
    request(app)
      .post('/stats?referrer=eirik')
      .set('X-User', statsuser.j())
      .set(config.headerHash, statshash.h())
      .set(config.headerControlNumber, statshash.number)
      .end(function(err, res) {
        res.status.should.equal(204);
        res.header.should.have.property('x-crashes');
        res.header.should.have.property('x-opponents');
        app.data.recruiters.should.have.property('eirik');
        // Give the redis pub/sub some time.
        setTimeout(function() {
          app.data.recruiters.should.have.property('eirik');
          app.data.rewards.eirik.should.equal(100000);
          done(err);
        }, 50);
      });
  });
});
describe('Slave server', function() {

  it('Should start slave and not throw errors when asked to', function(done) {
    app.masterhostname = 'localhost';
    app.masterport = 4000;
    app.masterscheme = 'http';
    app.startSlave(function(err, res) {
      should(err).equal(null);
      res.rewards.eirik.should.be.above(1000);
      done();
    });
  });

  it('Should not start when masterhostname is bogus', function(done) {
    this.timeout(10000);
    app.masterhostname = 'stupidhostname...123456';
    app.startSlave(function(err) {
      err.should.not.equal(null);
      done();
    });
  });

});
describe('Posting high scores', function() {

  it('Should respond as expected when posting high scores', function(done) {
    // Create a correct hash.
    var correctHash = crypto.createHash('md5')
      .update('1000burn rubber, burn!').digest('hex');
    var user = new Testuser();
    var hash = new Hash(user);
    request(app)
      .post('/score')
      .send({check: correctHash, score: '1000'})
      .set('X-User', user.j())
      .set(config.headerHash, hash.h())
      .set(config.headerControlNumber, hash.number)
      .end(function(err, res) {
        res.status.should.equal(200);
        done(err);
      });
  });

  it('Should respond as expected when posting scores with no hash', function(done) {
    // Create a correct hash.
    var user = new Testuser();
    var hash = new Hash(user);
    request(app)
      .post('/score')
      .send({score: '1000'})
      .set('X-User', user.j())
      .set(config.headerHash, hash.h())
      .set(config.headerControlNumber, hash.number)
      .expect(410)
      .end(function(err) {
        done(err);
      });
  });

  it('Should respond as expected when posting scores with wrong hash', function(done) {
    // Create a correct hash.
    var wrongHash = crypto.createHash('md5')
      .update('Random crappy string' + Math.random()).digest('hex');
    var user = new Testuser();
    var hash = new Hash(user);
    request(app)
      .post('/score')
      .send({check: wrongHash, score: '1000'})
      .set('X-User', user.j())
      .set(config.headerHash, hash.h())
      .set(config.headerControlNumber, hash.number)
      .expect(410)
      .end(function(err) {
        done(err);
      });
  });
});

describe('Storing messages', function() {
  it('Should respond to requests correctly, even when there is no message', function(done) {
    var user = new Testuser();
    var hash = new Hash(user);
    request(app)
      .post('/messages')
      .send({random: 'crap'})
      .set('X-User', user.j())
      .set(config.headerHash, hash.h())
      .set(config.headerControlNumber, hash.number)
      .expect(400)
      .end(function(err) {
        done(err);
      });
  });

  it('Should save a message when it is sent correctly', function(done) {
    var user = new Testuser();
    var hash = new Hash(user);
    request(app)
      .post('/messages')
      .send({message: 'test'})
      .set('X-User', user.j())
      .set(config.headerHash, hash.h())
      .set(config.headerControlNumber, hash.number)
      .end(function(err, res) {
        res.statusCode.should.equal(200);
        var t = res.header['x-timestamp'];
        var filepath = './messages/' + user.id + '-' + t + '.json';
        // See that the message is stored there.
        fs.existsSync(filepath).should.equal(true);
        // Remove it after we are done.
        fs.unlinkSync(filepath);
        fs.existsSync(filepath).should.equal(false);
        done(err);
      });
  });
});

describe('Other random functions', function() {
  it('Should return some info when we ask for /users', function(done) {
    request(app)
    .get('/users')
    .end(function(err, res) {
      res.status.should.equal(200);
      done(err);
    });
  });

  it('Should return nothing if we try for status and do not know secret', function(done) {
    request(app)
    .get('/current-status')
    .expect(418)
    .end(function(err) {
      done(err);
    });
  });

  it('Should return something if we try for status and do know secret', function(done) {
    request(app)
    .get('/current-status?secret=' + app.secret)
    .end(function(err, res) {
      res.status.should.equal(200);
      done(err);
    });
  });

});
