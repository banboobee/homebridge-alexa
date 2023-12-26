"use strict";
// var debug = require('debug')('alexaPlugin');

var AlexaLocal = require('./lib/alexaLocal.js').alexaLocal;
var alexaActions = require('./lib/alexaActions.js');
var EventEmitter = require('events').EventEmitter;
var os = require("os");

const packageConfig = require('./package.json');
let Service, Characteristic, HistoryService, homebridgelib, eve;

var options = {};
var alexaService = {};

module.exports = function (homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  HistoryService = require('fakegato-history')(homebridge);
  homebridgelib = require('homebridge-lib');
  eve = new homebridgelib.EveHomeKitTypes(homebridge);

  homebridge.registerPlatform("homebridge-alexa", "Alexa", alexaHome);
};

function alexaHome(log, config, api) {
  this.log = log;
  this.eventBus = new EventEmitter();
  this.config = config;
  this.pin = config['pin'] || "031-45-154";
  this.username = config['username'] || false;
  this.password = config['password'] || false;
  this.filter = config['filter'];
  this.instanceBlacklist = config['instanceBlacklist'];
  this.beta = config['beta'] || false;
  this.events = config['routines'] || false;
  this.combine = config['combine'] || false;
  this.oldParser = config['oldParser'] || false;
  this.refresh = config['refresh'] || 60 * 15; // Value in seconds, default every 15 minute's
  this.speakers = config['speakers'] || false; // Array of speaker devices
  this.inputs = config['inputs'] || false; // Array of input devices
  this.channel = config['channel'] || false; // Array of input devices
  this.blind = config['blind'] || false; // Use range controller for Blinds
  this.deviceListHandling = config['deviceListHandling'] || []; // Use ea
  this.deviceList = config['deviceList'] || []; // Use ea
  this.door = config['door'] || false; // Use mode controller for Garage Doors
  this.name = config['name'] || "Alexa";
  this.mergeServiceName = config['mergeServiceName'] || false;
  this.CloudTransport = config['CloudTransport'] || "mqtts"; // Default to mqtts Transport
  this.LegacyCloudTransport = config['LegacyCloudTransport'] || false; // Default to new Transport ( Setting from discarded beta )
  var mqttKeepalive = config['keepalive'] || 5; // MQTT Connection Keepalive

  if (mqttKeepalive < 60) {
    this.keepalive = mqttKeepalive * 60;
  } else {
    this.keepalive = mqttKeepalive;
  }

  if (this.CloudTransport && ['mqtt', 'wss', 'mqtts'].includes(this.CloudTransport)) {
    // Okay
  } else {
    this.log.error("ERROR: Invalid CloudTransport setting, defaulting to mqtts.");
    this.CloudTransport = "mqtts";
  }

  // Enable config based DEBUG logging enable
  this.debug = config['debug'] || false;
  if (this.debug) {
    let debugEnable = require('debug');
    let namespaces = debugEnable.disable();

    // this.log("DEBUG-1", namespaces);
    if (namespaces) {
      namespaces = namespaces + ',alexa*';
    } else {
      namespaces = 'alexa*';
    }
    // this.log("DEBUG-2", namespaces);
    debugEnable.enable(namespaces);
  }

  if (!this.username || !this.password) {
    this.log.error("Missing username and password");
  }

  if (this.oldParser) {
    this.log.error("ERROR: oldParser was deprecated with version 0.5.0, defaulting to new Parser.");
  }

  if (api) {
    this.api = api;
    this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
  }

  this.log.info(
    '%s v%s, node %s, homebridge v%s',
    packageConfig.name, packageConfig.version, process.version, api.serverVersion
  );
}

alexaHome.prototype = {
  accessories: function (callback) {
    // this.log("Accessories");
    var accessories = [];
    accessories.push(new AlexaService(this.name, this.log));
    callback(accessories);
  }
};

alexaHome.prototype.didFinishLaunching = function () {
  var host = (this.CloudTransport === 'wss' ? 'www.homebridge.ca' : 'alexa.homebridge.ca');
  var reconnectPeriod = 65000; // Increased reconnect period to allow DDOS protection to reset
  if (this.beta) {
    host = 'clone.homebridge.ca';
  }
  options = {
    // Shared Options
    log: this.log,
    debug: this.debug,
    // MQTT Options
    mqttURL: (this.CloudTransport === 'wss' ? "wss://" + host + "/ws" : (this.CloudTransport === 'mqtts' ? "mqtts://" + host + ":8883/" : "mqtt://" + host + ":1883/")),
    transport: this.CloudTransport,
    mqttOptions: {
      username: this.username,
      password: this.password,
      reconnectPeriod: reconnectPeriod, // Increased reconnect period to allow DDOS protection to reset
      keepalive: (this.CloudTransport === 'wss' ? 55 : this.keepalive), // Keep alive not used when using WSS Transport
      rejectUnauthorized: false
    },
    // HAP Node Client options
    pin: this.pin,
    refresh: this.refresh,
    eventBus: this.eventBus,
    // HB Parser options
    oldParser: this.oldParser,
    combine: this.combine,
    speakers: this.speakers,
    filter: this.filter,
    instanceBlacklist: this.instanceBlacklist,
    alexaService: alexaService,
    Characteristic: Characteristic,
    inputs: this.inputs,
    channel: this.channel,
    blind: this.blind,
    deviceListHandling: this.deviceListHandling,
    deviceList: this.deviceList,
    door: this.door,
    mergeServiceName: this.mergeServiceName,
    // Other Options
    events: this.events
  };

  // Initialize HAP Connections
  alexaActions.hapDiscovery(options);

  var alexa = new AlexaLocal(options);

  // Homebridge HAP Node Events

  this.eventBus.on('hapEvent', alexaActions.alexaEvent.bind(this));

  // Alexa mesages

  this.eventBus.on('System', function (message) {
    this.log.error("ERROR:", message.directive.header.message);
  }.bind(this));
  this.eventBus.on('Warning', function (message) {
    this.log.warn("Warning:", message.directive.header.message);
  }.bind(this));
  this.eventBus.on('Information', function (message) {
    this.log("Info:", message.directive.header.message);
  }.bind(this));
  this.eventBus.on('Alexa', alexaActions.alexaMessage.bind(this));
  this.eventBus.on('Alexa.Discovery', alexaActions.alexaDiscovery.bind(this));
  this.eventBus.on('Alexa.PowerController', alexaActions.alexaPowerController.bind(this));
  this.eventBus.on('Alexa.PowerLevelController', alexaActions.alexaPowerLevelController.bind(this));
  this.eventBus.on('Alexa.ColorController', alexaActions.alexaColorController.bind(this));
  this.eventBus.on('Alexa.ColorTemperatureController', alexaActions.alexaColorTemperatureController.bind(this));
  this.eventBus.on('Alexa.PlaybackController', alexaActions.alexaPlaybackController.bind(this));
  this.eventBus.on('Alexa.Speaker', alexaActions.alexaSpeaker.bind(this));
  this.eventBus.on('Alexa.ThermostatController', alexaActions.alexaThermostatController.bind(this));
  this.eventBus.on('Alexa.LockController', alexaActions.alexaLockController.bind(this));
  this.eventBus.on('Alexa.ChannelController', alexaActions.alexaChannelController.bind(this));
  this.eventBus.on('Alexa.StepSpeaker', alexaActions.alexaStepSpeaker.bind(this));
  this.eventBus.on('Alexa.InputController', alexaActions.alexaInputController.bind(this));
  this.eventBus.on('Alexa.ModeController', alexaActions.alexaModeController.bind(this));
  this.eventBus.on('Alexa.RangeController', alexaActions.alexaRangeController.bind(this));
};

/*
alexaHome.prototype.configureAccessory = function(accessory) {
  this.log("configureAccessory");
  // callback();
};
*/

function AlexaService(name, log) {
  this.name = name;
  this.log = log;
  this.services = [];
  this.listenerStatus = false;
  this.contactStatus = Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
  this.timesOpened = 0;
  this.lastReset = Math.round(new Date().valueOf()/1000) - Math.round(Date.parse('01 Jan 2001 00:00:00 GMT')/1000);
  this.lastActivation = 0;
  this.listenerTimeout = undefined;

  var hostname = os.hostname();

  alexaService.informationService = new Service.AccessoryInformation();
  alexaService.informationService
    .setCharacteristic(Characteristic.Manufacturer, "homebridge-alexa")
    .setCharacteristic(Characteristic.SerialNumber, "homebridge-alexa@"+hostname)
    .setCharacteristic(Characteristic.FirmwareRevision, require('./package.json').version);
  this.services.push(alexaService.informationService);

  alexaService.contact = new Service.ContactSensor(this.name + ' contact');
  alexaService.contact.setCharacteristic(
    Characteristic.ContactSensorState,
    Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
  alexaService.contact.addOptionalCharacteristic(eve.Characteristics.OpenDuration);
  alexaService.contact.getCharacteristic(eve.Characteristics.OpenDuration)
    .onGet(() => 0);
  alexaService.contact.addOptionalCharacteristic(eve.Characteristics.ClosedDuration);
  alexaService.contact.getCharacteristic(eve.Characteristics.ClosedDuration)
    .onGet(() => 0);
  alexaService.contact.addOptionalCharacteristic(eve.Characteristics.TimesOpened);
  alexaService.contact.getCharacteristic(eve.Characteristics.TimesOpened)
    .onGet(() => this.timesOpened);
  alexaService.contact.addOptionalCharacteristic(eve.Characteristics.LastActivation);
  alexaService.contact.getCharacteristic(eve.Characteristics.LastActivation)
    .onGet(() => {
      return this.lastActivation && alexaService.historyService.getInitialTime() ? 
	this.lastActivation - alexaService.historyService.getInitialTime() : 0
    });
  alexaService.contact.addOptionalCharacteristic(eve.Characteristics.ResetTotal);
  alexaService.contact.getCharacteristic(eve.Characteristics.ResetTotal)
    .onSet((reset) => {
      this.timesOpened = 0;
      this.lastReset = reset;
      alexaService.contact.updateCharacteristic(eve.Characteristics.TimesOpened, 0);
    })
    .onGet(() => {
      return this.lastReset
    });
  alexaService.contact.getCharacteristic(Characteristic.ContactSensorState)
    .on('change', (event) => {
      if (event.newValue !== event.oldValue) {
	// this.log(`${this.name}: contact on change: ${JSON.stringify(event)}`);
	this.contactStatus = event.newValue;
        const entry = {
          time: Math.round(new Date().valueOf()/1000),
          contact: event.newValue
        };
        this.lastActivation = entry.time;
        alexaService.contact.updateCharacteristic(
	  eve.Characteristics.LastActivation,
	  alexaService.historyService.getInitialTime() ? 
	    this.lastActivation - alexaService.historyService.getInitialTime() : 0);
        if (entry.contact) {
	  this.timesOpened++;
          alexaService.contact.updateCharacteristic(eve.Characteristics.TimesOpened, this.timesOpened);
        }
        alexaService.historyService.addEntry(entry);
      }
    });
  this.services.push(alexaService.contact);
  
  alexaService.listener = new Service.Switch(this.name + ' listener');
  alexaService.listener.getCharacteristic(Characteristic.On)
    .onGet(() => this.listenerStatus)
    .on('change', (event) => {
      if (event.newValue !== event.oldValue) {
	// this.log(`${this.name}: listener on change: ${JSON.stringify(event)}`);
	this.listenerStatus = event.newValue;
	if (event.newValue) {
	  clearTimeout(this.listenerTimeout);
	  this.listenerTimeout = setTimeout(() => {
	    // this.log(`${this.name}: listener turned OFF.`);
	    alexaService.listener.updateCharacteristic(Characteristic.On, false);
	  }, 1000);
	}
        alexaService.historyService.addEntry({
          time: Math.round(new Date().valueOf()/1000),
          status: event.newValue
        });
      }
    });
  this.services.push(alexaService.listener);
  
  alexaService.historyService = new HistoryService('custom', this,
   {storage: 'fs', filename: `${hostname.split(".")[0]}_${this.name}_persist.json`});
  this.services.push(alexaService.historyService);
  this.updateHistory();
}

AlexaService.prototype = {
  getServices: function () {
    // this.log("getServices", this.name);
    return this.services;
  },
  updateHistory: function () {
    alexaService.historyService.addEntry({
      time: Math.round(new Date().valueOf() / 1000),
      contact: this.contactStatus,
      status: this.listenerStatus})
    setTimeout(() => {
      this.updateHistory();
    }, 10 * 60 * 1000);
  }

  // getServices: function () {
  //   // this.log("getServices", this.name);
  //   // Information Service
  //   var informationService = new Service.AccessoryInformation();
  //   var hostname = os.hostname();

  //   informationService
  //     .setCharacteristic(Characteristic.Manufacturer, "homebridge-alexa")
  //     .setCharacteristic(Characteristic.SerialNumber, hostname)
  //     .setCharacteristic(Characteristic.FirmwareRevision, require('./package.json').version);
  //   // Thermostat Service

  //   alexaService = new Service.ContactSensor(this.name);

  //   return [informationService, alexaService, alexaStream, historyService];
  // }
};
