'use strict';

var model = function(id, name, timestamp){
  this.id = id;
  this.name = name;
  /* istanbul ignore next*/
  this.timestamp = timestamp || Date.now();
  this.room = '';
  this.mail = '';
};
model.prototype.publish = function(app, client) {
  client.publish(app.namespace + '.newuser', JSON.stringify(this));
};

model.prototype.connected = function(app, client) {
  client.publish(app.namespace + '.newuser_connect', JSON.stringify(this));
};

module.exports = model;
