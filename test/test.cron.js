const { Testuser, Hash, app, config } = require('./helpers')
const helpers = require('../src/helpers');
const request = require('supertest');
const cron = require('../src/cron');
require('should')

describe('Cron', function() {

  this.timeout(100000);

  var user = new Testuser(),
    user2 = new Testuser(),
    hash = new Hash(user),
    hash2 = new Hash(user2),
    testroom = 'room' + Math.floor(Math.random() * 1000 + 1),
    timestamp = helpers.currentTimestamp();

  before(function(done) {
    app.setConfig(config)
    app.init(done)
  })

  before(function(done){
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
  before(function(done){
    request(app)
    .get('/connect')
    .set('X-User', user2.j())
    .set(config.headerHash, hash2.hash)
    .set(config.headerControlNumber, hash2.number)
    .end(function(err, res) {
      res.status.should.equal(200);
      done(err);
    });
  });
  before(function(done) {
    request(app)
    .post('/game?game=' + testroom)
    .set('X-User', user.j())
    .set(config.headerHash, hash.h())
    .set(config.headerControlNumber, hash.number)
    .end(function(err, res) {
      res.status.should.equal(200);
      done(err);
    });
  });
  before(function(done) {
    request(app)
    .post('/game?game=' + testroom)
    .set('X-User', user2.j())
    .set(config.headerHash, hash2.h())
    .set(config.headerControlNumber, hash2.number)
    .end(function(err, res) {
      res.status.should.equal(200);
      done(err);
    });
  });
  before(function(done) {
    request(app)
    .post('/?message=hallo&type=join&room=' + testroom)
    .set('X-User', user.j())
    .set(config.headerHash, hash.h())
    .set(config.headerControlNumber, hash.number)
    .end(function(err, res) {
      res.status.should.equal(200);
      done(err);
    });
  });

  // ...and post a car event as well.
  before(function(done) {
    request(app)
    .post('/?room=' + testroom + '&message=fatcar&type=car')
    .set('X-User', user2.j())
    .set(config.headerHash, hash2.h())
    .set(config.headerControlNumber, hash2.number)
    .end(function(err, res) {
      res.status.should.equal(200);
      done(err);
    });
  });
  // ...and post a car event as well.
  before(function(done) {
    request(app)
    .post('/?room=' + testroom + '&message=bwcar&type=car')
    .set('X-User', user2.j())
    .set(config.headerHash, hash2.h())
    .set(config.headerControlNumber, hash2.number)
    .end(function(err, res) {
      res.status.should.equal(200);
      done(err);
    });
  });
  before(function(done) {
    request(app)
    .get('/poll?room=' + testroom + '&time=' + timestamp)
    .set('X-User', user2.j())
    .set(config.headerHash, hash2.h())
    .set(config.headerControlNumber, hash2.number)
    .end(function(err, res) {
      // Should return our first event.
      res.status.should.equal(200);
      done(err);
    });
  });

  it('Cron should be available', function(done) {
    cron.should.be.instanceOf(Function);
    done();
  });
  it('Cron should not have deleted our user', function(done) {
    cron(app);
    app.data.users.should.have.property(user.id);
    done();
  });
  it('Event should be there even after cron', function(done) {
    app.data.events[testroom][0].should.have.property('message', 'hallo');
    done();
  });
  it('App should have our user in room after cron', function(done) {
    app.data.games[testroom].users.should.have.property(user.id);
    done();
  });
  it('Cron should have deleted an old user', function(done) {
    // Set the user to be 6 minutes old.
    app.data.users[user.id].time = timestamp - 360000;
    cron(app);
    app.data.users.should.not.have.property(user.id);
    done();
  });
  it('Cron should have deleted an old user\'s events', function(done) {
    for (var e in app.data.games[testroom].events) {
      app.data.games[testroom].events[e].should.not.have.property(user.id);
    }
    done();
  });
  it('Cron should have deleted an old event', function(done) {
    // Set the event to be 6 minutes old.
    app.data.events[testroom][0].timestamp = timestamp - 360000;
    // And one of the car events.
    app.data.events[testroom][1].timestamp = timestamp - 360000;
    cron(app);
    app.data.events[testroom].should.have.lengthOf(1);
    done();
  });
  it('Cron should have deleted an old user from room', function(done) {
    app.data.games[testroom].users.should.not.have.property(user.id);
    done();
  });
  it('Cron should have deleted an empty room', function(done) {
    app.data.users[user2.id].time = timestamp - 360000;
    app.data.users[user2.id].room = testroom;
    cron(app);
    app.data.games.should.not.have.property(testroom);
    done();
  });
  it('Cron should have deleted an empty room, even if some users has been there through a reconnect', function(done) {
    var unsubscribed = 'testuser_un';
    app.data.games[testroom] = {};
    app.data.games[testroom].users = {};
    app.data.games[testroom].users[unsubscribed] = {
      time: timestamp - 360000
    };
    app.data.games.should.have.property(testroom);
    cron(app);
    app.data.games.should.not.have.property(testroom);
    done();
  });
  it('Cron should delete old loner rooms', function(done) {
    var loner = testroom + 'loner';
    // Create a fake loner room.
    app.data.loners[loner] = helpers.currentTimestamp();
    // Run cron.
    cron(app);
    // See if the loner is still there.
    app.data.loners.should.have.property(loner);
    // Manipulate the timestamp.
    app.data.loners[loner] = timestamp - 700000;
    cron(app);
    app.data.loners.should.not.have.property(loner);
    done();
  });
});
