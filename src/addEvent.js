'use strict';

module.exports = function(app) {
  var EventModel = app.eventModel;
  var pubclient = app.pubclient;
  return function(user, type, room, message, name) {
    var event = new EventModel(user, type, message, name);
    event.publish(app, pubclient, room);
  };
};
