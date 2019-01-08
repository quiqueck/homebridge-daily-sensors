'use strict';
const moment = require('moment'),
      packageJSON = require("../package.json"),
      express = require('express'),
      path = require('path'),
      fs = require('fs');

var WebServers = {};
var WebPaths = {};

exports.startServerForSensor = function(sensor){
    if (sensor.port > 0) {
        const port = sensor.port;
        if (sensor.debug) sensor.log(`Starting HTTP listener on port ${port} for path ${sensor.webPath}...`);

        var expressApp = WebServers[sensor.port];
        var masterForPort = false;
        if (expressApp === undefined) {
            masterForPort = true;
            expressApp = express();
            expressApp.listen(port, (err) =>
            {
                if (err) {
                    console.error(`Failed to start Express on port ${port}!`, err);
                } else {
                    if (sensor.debug) sensor.log(`Express is running on port ${port}.`)
                }
            });

            WebServers[sensor.port] = expressApp;
        }

        //get list of available paths on a port
        var paths = WebPaths[sensor.port];
        if (paths === undefined){
            paths = [];
            WebPaths[sensor.port] = paths;
        }
        paths.push({
            path:sensor.webPath,
            name:sensor.config.name,
            object:sensor
        })

        
        expressApp.get(sensor.webPath+"/0", (request, response) => {
            sensor.override = false;
            sensor.syncSwitchState();           
            response.json({
                operation:'off',
                ok:true,
                ...JSONCommonResponse(sensor, request)
            });
            if (sensor.debug) sensor.log("received OFF");
        });
        expressApp.get(sensor.webPath+"/1", (request, response) => {
            sensor.override = true;
            sensor.syncSwitchState();          
            response.json({
                operation:'on',
                ok:true,
                ...JSONCommonResponse(sensor, request)
            });
            if (sensor.debug) sensor.log("received ON");
        });
        expressApp.get(sensor.webPath+"/clear", (request, response) => {
            sensor.override = undefined;
            sensor.syncSwitchState();  

            response.json({
                operation:'clear',
                ok:true,
                ...JSONCommonResponse(sensor, request)
            });
            if (sensor.debug) sensor.log("received CLEAR");
        });
        expressApp.get(sensor.webPath+"/state", (request, response) => {
            response.json(JSONCommonResponse(sensor, request));
            if (sensor.debug) sensor.log("received STATE");
        });
        expressApp.get(sensor.webPath+"/reload", (request, response) => {
            sensor.fetchEvents(new Date());
            response.json({
                operation:'reload',
                ok:true,
                ...JSONCommonResponse(sensor, request)
            });
            if (sensor.debug) sensor.log("received STATE");
        });
        expressApp.get(sensor.webPath+"/", (request, response) => {               
            response.send(buildInfoHTML(sensor));
        }); 

        if (masterForPort) {
            expressApp.get("/js/d3.js", (request, response) => {               
                response.sendFile(path.join(__dirname, '../js/d3.v5.min.js'));           
            }); 
            expressApp.get("/js/jquery.min.js", (request, response) => {               
                response.sendFile(path.join(__dirname, '../js/jquery-3.3.1.min.js'));           
            }); 
            expressApp.get("/js/bootstrap.min.js", (request, response) => {               
                response.sendFile(path.join(__dirname, '../js/bootstrap.min.js'));           
            });
            expressApp.get("/css/bootstrap.min.css", (request, response) => {               
                response.sendFile(path.join(__dirname, '../css/bootstrap.min.css'));           
            }); 
            expressApp.get("/css/style.css", (request, response) => {               
                response.sendFile(path.join(__dirname, '../css/style.css'));           
            });
            expressApp.get("/js/bootstrap.min.js.map", (request, response) => {               
                response.sendFile(path.join(__dirname, '../js/bootstrap.min.js.map'));           
            });  
            
            expressApp.get("/css/bootstrap.min.css.map", (request, response) => {               
                response.sendFile(path.join(__dirname, '../css/bootstrap.min.css.map'));           
            }); 
            expressApp.get("/", (request, response) => {               
                response.send(buildIndexHTML(sensor));           
            }); 
            expressApp.get("/accessories", (request, response) => {   
                var json = {
                    host:request.headers.host,
                    accessories:[]
                }
                WebPaths[sensor.port].forEach(path => {
                    json.accessories.push({
                        path:path.path,
                        name:path.name,
                        info:JSONCommonResponse(path.object, request)
                    });
                });
                response.json(json);           
            });
        }
        sensor.log("HTTP listener started on port " + port + "  for path " + sensor.webPath + ".");
    }
}

function JSONCommonResponse(sensor, request) {
    const ovr = sensor.override === undefined ? undefined : {
        forced:sensor.override,
        actual:sensor.isActive
    };
    return {
        accessory:{
            name : sensor.config.name,
            host : request.headers.host,                        
            path : sensor.webPath
        },
        activeState:sensor.getIsActive(),
        override:ovr
    }
}

function buildIndexHTML(sensor){        
    let s = fs.readFileSync(path.join(__dirname, '../index.html'), { encoding: 'utf8' });

    s = s.replace('\{\{VERSION\}\}', packageJSON.version);
    return s;
}

function buildInfoHTML(sensor){
    function formatState(state, bold){
        if (bold===undefined) bold=true;
        let s = '<'+(bold?'b':'span')+' style="color:'+(state?'green':'red')+'">';
        s += (state?'ON':'OFF');
        s += '</'+(bold?'b':'span')+'>';
        return s;
    }
    const start = moment({h: 0, m: 0, s: 1})

    const minutes = 1;
    let offset = 0;
    let p = 0;

    let conditionData = [{data:[], name:'Daystart'}, {data:[], name:'Daystart'}];
    sensor.triggers.forEach(trigger => {
        conditionData[2*trigger.id] = {
            data:[],
            name:sensor.formatTrigger(trigger)
        }
        conditionData[2*trigger.id+1] = {
            data:[],
            name:"Result after " + sensor.formatTrigger(trigger)
        }
    });

    let data = [
        {data:[], min:-1, max:+1, name:'active', blocky:true},
        {data:[], min:-90, max:90, name:'altitude', blocky:false},
        {data:[], min:0, max:100000, name:'lux', blocky:false}];

    let eventList = {data:[]};        
    sensor.events.forEach(event => {
        eventList.data.push({
            date:event.when,
            name:triggerEventName(EventTypes[event.event]),
            value:(180*event.pos.altitude/Math.PI) / 90
        });
    });
                                                    

    let tableHTML = '';  
    const self = sensor; 
    const dayStart =  sensor.config.dayStartsActive ? sensor.config.dayStartsActive : false;     

    while (offset < 60*24) {
        const mom = start.add(minutes, 'minutes');            
        const when = mom.toDate();
        const obj = sensor.testIfActive(when);
        
        if (sensor.debug) sensor.log(when, obj.active);

        conditionData[0].data[p] = {
            date : mom.toDate(),
            value : dayStart
        }; 
        conditionData[1].data[p] = {
            date : mom.toDate(),
            value : dayStart
        };  
        var all = dayStart;             
        sensor.triggers.forEach(trigger => {
            var item = conditionData[2*trigger.id];
            var itemAll = conditionData[2*trigger.id+1];

            var one = undefined;
            one = self.testTrigger(trigger, when, obj, one, true, true);
            all = self.testTrigger(trigger, when, obj, all, false, true);
            
            item.data[p] = {
                date : mom.toDate(),
                value : one
            };
            itemAll.data[p] = {
                date : mom.toDate(),
                value : all
            };                
        });

        data[0].data[p] = {
            date : mom.toDate(),
            value : obj.active ? 1 : 0,
            time : mom.format('LT'),
            values : [obj.active ? 0 : -1, obj.active ? 0 : 1]
        }; 
        data[1].data[p] = {
            date : mom.toDate(),
            value : 180*obj.pos.altitude/Math.PI,
            time : mom.format('LT'),
            values : [Math.min(180*obj.pos.altitude/Math.PI, 0), Math.max(180*obj.pos.altitude/Math.PI, 0)]
        };
        data[2].data[p] = {
            date : mom.toDate(),
            value : obj.lux,
            time : mom.format('LT'),
            values : [Math.min(obj.lux, 0), Math.max(obj.lux, 0)]
        };            
        offset += minutes;
        p++;

        const e = sensor.fetchEventAt(when);
        const et = triggerEventName(e ? EventTypes[e.event] : -1);
        tableHTML += '<thead class="thead-dark"><tr><th colspan="4">';
        tableHTML += mom.format('LT')+', ';
        tableHTML += formatRadians(obj.pos.altitude)+', ';
        tableHTML += Math.round(obj.lux) +', ';
        tableHTML += et + '</th></tr></thead>';
        tableHTML += '<tr><td></td><td>Daystart</td><td style="width:1px"> =&gt; </td><td style="width:1px;">'+formatState(dayStart)+'</td></tr>';;

        var last = dayStart;
        obj.conditions.forEach(val => {
            tableHTML += '<tr><td></td><td>';
            tableHTML += sensor.formatTrigger(val.trigger);
            tableHTML += '</td><td style="width:1px;white-space: nowrap;"> =&gt; ';
            switch (val.trigger.op) {
                case TriggerOps.and:
                    tableHTML +=  formatState(last, false) + ' and ' + formatState(val.active, false) + ' = '
                    break;
                case TriggerOps.or:
                    tableHTML +=  formatState(last, false) + ' or ' + formatState(val.active, false) + ' = '
                    break;
                
                case TriggerOps.discard:
                    tableHTML +=  '[IGNORE]' ;
                    break;
                default:
                tableHTML +=  '';
            }
            tableHTML += '</td><td style="width:1px;white-space: nowrap;">'+formatState(val.result, val.trigger.op!=TriggerOps.discard)+'</td></tr>';
            last = val.result;
        })
        
    }
    
    let s = fs.readFileSync(path.join(__dirname, '../template.html'), { encoding: 'utf8' });

    s = s.replace('\{\{NAME\}\}', sensor.config.name);
    s = s.replace('\{\{DATA\}\}', JSON.stringify(data));
    s = s.replace('\{\{TABLE\}\}', tableHTML);
    s = s.replace('\{\{EVENT_DATA\}\}', JSON.stringify(eventList));
    s = s.replace('\{\{CONDITION_DATA\}\}', JSON.stringify(conditionData));
    return s;
}