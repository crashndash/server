const config = require('../config');

const Testuser = function() {
  this.name = 'randomuser' + Math.floor((Math.random() * 100) + 1);
  this.id = 'testuser' + Math.floor((Math.random() * 10000) + 1);
  this.version = app.version;
};
// Short names means less typing.
Testuser.prototype.j = function() {
  return JSON.stringify(this);
};
var hasher = require('../' + config.customHash);
var Hash = function(user) {
  this.number = Math.floor((Math.random() * 100) + 1);
  this.user = user;
  this.hash = hasher(this.user.id, this.user.version, this.number);
};
Hash.prototype.h = function() {
  this.number += 1;
  this.hash = hasher(this.user.id, this.user.version, this.number);
  return this.hash;
};

let app = require('../app');

module.exports = {
  Testuser: Testuser,
  app: app,
  Hash: Hash,
  config: config
}
