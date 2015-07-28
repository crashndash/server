'use strict';

var helpers = require('../src/helpers');

var EventModel = function(user, type, message, name) {
  this.type = type;
  this.message = message;
  this.from = user;
  this.fromname = name;
  this.timestamp = helpers.currentTimestamp();
};

EventModel.prototype.publish = function(app, client, room) {
  var send = {
    event: this,
    room: room
  };
  client.publish(app.namespace + '.events', JSON.stringify(send));
};

module.exports = EventModel;
