'use strict';
module.exports = function(req, res, next) {
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
