'use strict';
var config = require('./config');
var cron = require('./src/cron');
var app = require('./app');

app.setConfig(config)
.init();

setInterval(function() {
  cron(app);
}, app.cronInterval);
