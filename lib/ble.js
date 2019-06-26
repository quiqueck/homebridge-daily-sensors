'use strict';
// based on the noble code from homebridge-avea-btItem

const moment = require('moment'),
      packageJSON = require("../package.json"),
      path = require('path'),
      Noble = require('noble'),
      fs = require('fs'),
      $ = require('./helpers.js'),
      bleDailySwitch = require('./bleDailySwitch.js');

//Limits for Scanning
const maxNoOfSeqScans = 5;

const serviceUUID = bleDailySwitch.serviceUUID;
const switchCharacteristicUUID = bleDailySwitch.switchCharacteristicUUID;

class BluetoothClient {
    constructor(log, device, callback) {
        this.log = log;

        this.callback = callback;
        this.noOfSeqScans = 0;
        this.bluetoothid = device || null;
        this.scanning = false;
        this.bChangeSth = false;
    }

    // Noble State Change
    nobleStateChange (state) {
        if (state == "poweredOn") {
            this.log.debug("Starting Noble scan..");
            Noble.on('scanStop', function () {
                setTimeout(function () {
                    this.log.debug('Restart from scan stop');
                    this.startScanningWithTimeout();
                }.bind(this), 2500);
            }.bind(this));
            Noble.on("discover", this.nobleDiscovered.bind(this));
            this.startScanningWithTimeout();
            this.scanning = true;
        } else {
            this.log.debug("Noble state change to " + state + "; stopping scan.");
            Noble.removeAllListeners('scanStop');
            Noble.stopScanning();
            this.scanning = false;
        }
    }

    // Noble Discovery
    nobleDiscovered (peripheral) {
        this.log.info("Discovered:", peripheral.uuid);
        if (this.perifSel == null) {
            if ((peripheral.uuid == this.bluetoothid) || (this.bluetoothid == null)) {
                this.perifSel = peripheral;
                this.log.info("UUID matches!");
                this.stopScanning();
                this.scanning = false;
                this.btItem = new bleDailySwitch.item(this.log, this.perifSel, this.callback);
                this.btItem.connect(function (error) {
                    this.onBTItemConnect(error, peripheral);
                }.bind(this));
            } else {
                this.log.info("UUID not matching");
            }
        } else {
            // do a reconnect if uuid matches
            if (peripheral.uuid == this.bluetoothid) {
                this.log.info("Lost DailySwitch appears again!");
                this.perifSel = peripheral;
                if (this.perifSel.state != "connected") {
                    Noble.stopScanning();
                    this.scanning = false;
                    this.btItem = new bleDailySwitch.item(this.log, this.perifSel, this.callback);
                    this.btItem.connect(function (error) {
                        this.onBTItemConnect(error, peripheral);
                    }.bind(this));
                } else {
                    this.log.info("Undefined state");
                }
            } else {
                this.log.info("This is not the DailySwitch you are looking for");
            }
        }
    }

    // Noble Stop Scan
    nobleScanStop () {
        this.log.debug("ScanStop received");
        if (this.perifSel == null && maxNoOfSeqScans > this.noOfSeqScans++) {
            //Retry scan
            setTimeout(function () {
                this.log.debug('Retry from scan stop');
                this.startScanningWithTimeout();
            }.bind(this), 2500);
        } else {
            this.scanning = false;
        }
    }

    startScanningWithTimeout() {
        Noble.startScanning(serviceUUID, false);
        setTimeout(function () {
            if (Noble.listenerCount('discover') == 0) { return; }
            this.log.debug('Discovery timeout');
            Noble.stopScanning();
            this.scanning = false;
        }.bind(this), 12500);
    }

    stopScanning() {
        Noble.removeListener('discover', this.nobleDiscovered.bind(this))
        if (Noble.listenerCount('discover') == 0) {
            Noble.removeAllListeners('scanStop');
            Noble.stopScanning();
        }
    }

    onBTItemConnect(error, peripheral) {
        if (error){
            this.log.error("Connecting to " + peripheral.address + " failed: " + error);
            this.onDisconnect(error, peripheral);
            return;
        }
        this.log.debug("Connected to " + peripheral.address);
    }

    onDisconnect(error, peripheral) {
        peripheral.removeAllListeners();
        this.log.info("Disconnected");
        this.nobleDiscovered(peripheral);
    }
}

module.exports = function(log, devices, callback){          
    if (devices.length == 0) return undefined;
    //log = {info:log.info, debug:log.info, error:log.info};
    let scanners = {
        objects:[],
        initAll: function(){
            log.info("Init BLE for DailySwitch");
            this.objects.forEach(ble => {
                //Initialise the Noble service for talking to the btItem
                Noble.on('stateChange', ble.nobleStateChange.bind(ble));
                Noble.on('scanStop', ble.nobleScanStop.bind(ble));
            });
        }
    };
    devices.forEach(device => {
        log.info("Added Scanner for Device", device);
        const ble = new BluetoothClient(log, device, callback);            
        scanners.objects.push(ble);
    })
    
    return scanners;
}