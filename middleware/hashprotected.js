'use strict';
module.exports = function(config, app, req, res, next) {
  var getCorrectHash = require('./getCorrectHash')(config);
  var count = req.get(config.headerControlNumber);
  var hash = req.get(config.headerHash);

  /* istanbul ignore next */
  if (!req.userdata) {
    // Not even possible.
    res.send('', 400);
    return;
  }

  var user = req.userdata.id;
  var version = parseFloat(req.userdata.version);

  var usedHash = hash;
  var correctHash = getCorrectHash(user, version, count);

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
