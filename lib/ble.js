'use strict';
// based on the noble code from homebridge-avea-bulb

const moment = require('moment'),
      packageJSON = require("../package.json"),
      path = require('path'),
      Noble = require('noble'),
      fs = require('fs'),
      $ = require('./helpers.js'),
      bleDailySwitch = require('./bleDailySwitch.js');

var scanRestartCount = 0;
const maxScanRestarts = 5;
var watchdogCallCount = 0;
const watchdogCallsBeforeStop = 3;
const DISCOVERY_RUN_TIME = 20000;
const DISCOVERY_PAUSE_TIME = 5000;
const WATCHDOG_TIMER = 23000;
const WATCHDOG_RESTART_TIMER = 1000;
const serviceUUID = '0818c2dd127641059e650d10c8e27e35';
const switchCharacteristicUUID = "3e989a753437471ea50a20a838afcce7";

class BluetoothClient {
    constructor(log, devices, callback) {
        this.log = log;
        this.callback = callback;
        this.scanning = false;
        this.ready = false;
        this.connectionInFlight = 0;
        this.queuedStart = null;
        this.connectionProgress = false;
        this.devices = devices.map(d => {return {id:d, peripheral:undefined, connected:false, discovered:false};});

        //Initialise the Noble service for talking to enabled devices
        //Noble.on('stateChange', this.nobleStateChange.bind(this));
        this.scanStopListener = this.nobleScanStop.bind(this)
        //Noble.on('scanStop', this.scanStopListener);
        this.watchdog();
    }

    allDiscovered(){
        return !this.devices.some(item => !item.discovered );
    }

    deviceWithID(bid){
        return this.devices.find(item => item.id == bid); 
    }

    watchdog(){
        this.log.info("Called Watchdog...");
        //make sure we give the device a chance to connect the characteristics properly      
        if (this.connectionInFlight>0){
            this.connectionInFlight--;
            return;
        }  
        if (this.ready && (this.attachedDiscoverCall === undefined || Noble.listenerCount('discover')==0)){
            this.log.info("Watchdog restarted Discovery");
            this.attachedDiscoverCall = this.nobleDiscovered.bind(this);
            Noble.on("discover", this.attachedDiscoverCall);
            this.startScanningWithTimeout();
            watchdogCallCount = 0;
        } else if (this.ready && (this.attachedDiscoverCall !== undefined || Noble.listenerCount('discover')!=0)){
            this.log.info("Watchdog++"); 
            watchdogCallCount++;
            if (watchdogCallCount >= watchdogCallsBeforeStop) {
                watchdogCallCount = 0;
                this.log.info("Watchdog stops Discovery for", WATCHDOG_RESTART_TIMER);
                this.stopScanning();
                
                setTimeout(this.watchdog.bind(this), WATCHDOG_RESTART_TIMER)
                return;
            } 
        } else {
            this.log.info("watchdog ignored:", this.ready, this.attachedDiscoverCall===undefined, Noble.listenerCount('discover'));
        }
        setTimeout(this.watchdog.bind(this), WATCHDOG_TIMER)
    } 

    startConnection(device){
        this.log.info("Will connect", device.id);
        try {     
            if (device.connected) {
                this.log.info("Already Connected", device.id);
                return;
            }
            bleDailySwitch.connect(this, device, serviceUUID, switchCharacteristicUUID);
        } catch (error){
            this.log.error("Unhandled Error occured", error);
        }
    }

    // Noble State Change
    nobleStateChange (state) {
        if (state == "poweredOn") {
            this.ready = true;
            this.log.info("Starting Noble scan..");            
            
            if (this.attachedDiscoverCall === undefined) {
                this.attachedDiscoverCall = this.nobleDiscovered.bind(this);
                Noble.on("discover", this.attachedDiscoverCall);
            }

            this.startScanningWithTimeout();
            this.scanning = true;
        } else {
            this.ready = false;
            this.log.info("Noble state change to " + state + "; stopping scan.");
            if (this.scanStopListener !== undefined) {
                Noble.removeListener('scanStop', this.scanStopListener);
                this.scanStopListener = undefined;
            }            
            if (this.attachedDiscoverCall !== undefined){
                Noble.removeListener('discover', this.attachedDiscoverCall);
                this.attachedDiscoverCall = undefined;
            }
            this.log.debug('State Changed to '+state+'. Stopping Scan for Service ' + serviceUUID);
            Noble.stopScanning();
            
            this.scanning = false;
        }
    }
    
    // Noble Stop Scan
    nobleScanStop() {
        //this.log.debug('ScanStop received: allFound=' + this.allDiscovered() + ', ct=' + scanRestartCount);
    }

    restartDiscovery(){
        if (this.restartTimerCall === undefined) {
            this.restartTimerCall = setTimeout(function () {
                if (!this.allDiscovered()){
                    scanRestartCount++;
                    this.restartTimerCall = undefined;
                    this.log.debug('Restarting Discovery allFound=' + this.allDiscovered() + ', ct=' + scanRestartCount + ', where=event');
                    this.startScanningWithTimeout();
                }
            }.bind(this), DISCOVERY_PAUSE_TIME);
        }        
    }

    ensureScanStopNotification(){
        if (this.scanStopListener !== undefined) {
            //someone deleted our listener :()
            if (!Noble.listeners('scanStop').some(t=>t===this.scanStopListener)){
                this.log.error("Outsider deleted listener ...restoring");
                this.scanStopListener = this.nobleScanStop.bind(this)
                Noble.on('scanStop', this.scanStopListener);
            }
        } else {
            this.scanStopListener = this.nobleScanStop.bind(this)
            Noble.on('scanStop', this.scanStopListener);
        }
    }

    startScanningWithTimeout() {
        this.ensureScanStopNotification();
        const self = this;
        this.log.info("Start Scanning for Service", serviceUUID);
        
        Noble.startScanning([serviceUUID], false, (error) => {            
            if (error) {
                this.log.error("Failed to Start Scan:", error);
            } else {
                this.log.debug("Started Scan");
            }
        });
        setTimeout(function () {
            if (Noble.listenerCount('discover') == 0) { return; }
            this.log.debug('Discovery timeout. Stopping Scan for Service ' + serviceUUID);
            this.ensureScanStopNotification();
            Noble.stopScanning();
            this.scanning = false;

            this.restartDiscovery();
        }.bind(this), DISCOVERY_RUN_TIME);
    }

    stopScanning() {
        if (this.attachedDiscoverCall !== undefined){
            Noble.removeListener('discover', this.attachedDiscoverCall);
            this.attachedDiscoverCall = undefined;
        }
        this.log.debug("Stop Scanning?", Noble.listenerCount('discover') );
        
        if (Noble.listenerCount('discover') == 0) {
            if (this.restartTimerCall !== undefined){
                clearTimeout(this.restartTimerCall);
                this.restartTimerCall = undefined;
            }
            if (this.scanStopListener !== undefined) {
                Noble.removeListener('scanStop', this.scanStopListener);
                this.scanStopListener = undefined;
            }
            this.log.debug('Stopping Scan for Service ' + serviceUUID);
            Noble.stopScanning();
        }
    }

    // Noble Discovery
    nobleDiscovered(peripheral) {
        this.log.debug("Discovered:", peripheral.uuid, peripheral.advertisement.localName);
        const device = this.deviceWithID(peripheral.uuid);

        if (this.devices.length == 0) {
            this.stopScanning(); //its is over (forever)
            this.scanning = false;
        } else if (device !== undefined && device!==null && device.peripheral===undefined) {
            this.connectionInFlight = 5;
            device.peripheral = peripheral; 
            device.discovered = true;               
            this.log.info("Found new Device ", peripheral.advertisement.localName);
            
            const self = this;
            if (this.allDiscovered()){
                self.stopScanning();
                self.scanning = false;                
            }

            this.log.info("Will connect", device.id, "in", 3000);
            if (this.queuedStart) {
                this.log.info("Clean old Timeout");
                clearTimeout(this.queuedStart);
                this.queuedStart = null;
            }
            this.queuedStart = setTimeout(this.startConnection.bind(this, device), 3000);
            //this.startConnection(device);
        } else if (device !== undefined && device!==null) {
                this.connectionInFlight = 5;
                this.log.info("Lost device " + device.id + " reappeared!");
                
                /*device.peripheral.removeAllListeners('connect');
                device.peripheral.removeAllListeners('disconnect');
                device.peripheral.removeAllListeners('servicesDiscover');
                device.peripheral = undefined;*/

                if (device.switchCharacteristic){
                    device.switchCharacteristic.unsubscribe((err)=>{});
                    device.switchCharacteristic.removeAllListeners('data');                
                    device.switchCharacteristic = undefined;
                }

                device.peripheral = peripheral;
                device.discovered = true;
                if (device.peripheral.state != "connected") {
                    const self = this;
                    if (this.allDiscovered()){
                        self.stopScanning();
                        self.scanning = false;                        
                    }
                    this.log.info("Will connect", device.id, "in", 2000);
                    if (this.queuedStart) {
                        this.log.info("Clean old Timeout");
                        clearTimeout(this.queuedStart);
                        this.queuedStart = null;
                    }
                    this.queuedStart = setTimeout(this.startConnection.bind(this, device), 2000);
                    //this.startConnection(device);
                } else {
                    this.log.error("    ... Undefined state");
                }
        } else {
            this.log.debug("    ... Ignoring", peripheral.uuid, this.devices, device);
        }
    }
}

module.exports = function(log, devices, callback){  
    return {
        object:null,
        initAll: function(){}
    } 
      
    if (devices.length == 0) return undefined;
    log = {info:log.info, debug:log.debug, error:log.info};
    let scanners = {
        object:null,
        initAll: function(){
            log.info("Init BLE for DailySwitch");
            Noble.on('stateChange', this.object.nobleStateChange.bind(this.object));
            Noble.on('scanStop', this.object.nobleScanStop.bind(this.object));
            
        }
    };
    devices.forEach(device => {
        log.info("Added Scanner for Device", device);          
        scanners.object = new BluetoothClient(log, [device], callback);  
    })
    
    return scanners;
}