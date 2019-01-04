# homebridge-daily-sensors
This programable switch can be triggered based on userdefine rules related to time, daily events, sun elevation
or amount of ambient light. Each TriggerEvent can be randomized to make sure that the rules trigger at slightly different times each day.

## Simple Configuration
The following configuration is based on the suns elevation (altitude) in London. If the sun rises above 3° the switch will be triggered (with a single press (<= `active:true`)). If the sun gets below 3° it triggers a double press
```json
  "accessories": [{
      "accessory": "DailySensors",
      "name":"My new daily switch",
      "dayStartsActive":false,    
      "trigger":[{
            "active":true,
            "type":"altitude",
            "value":"0.03",
            "trigger":"both"
      }],
      "location":{
        "longitude":-0.118092,
        "latitude":51.509865
      }
  }]
```

## How does it work?
The plugin calculates typical sun events as well as the suns elevation based on a given location. Each sensor has a given activation state at any given time of a day. Whenever the activation state changes, the Programmable switch is notified. If the state changes from **off to on**, a **single press** is sent. if it changes from **on to off** a **double press** is generated. The activation state is determined through an array of TriggerEvents.

All TriggerEvent are stored in the `trigger:array` config variable. Each TriggerEvent has the following basic properties:
- `type` : The type of the TriggerEvent (`time`, `altitude`, `lux` or `event`). 
- `value` : A given treshold that is compared 
- `active` : The new activation state of the sensor if the TriggerEvent is triggered 

The sensor receives a tick event in a certain interval (config variable `tickTimer:seconds`). At every tick, all TriggerEvents are evaluated in sequence and the state of the sensor is determined (active/deactive) like this:s
- First the activation state is set to the state defined in `dayStartsActive:bool`.
- Each TriggerEvent (config variable `trigger:array`) is evaluated in the given sequence. 
- If a TriggerEvent is triggered, the activation state is recalculated. Normaly a TriggerEvent is triggered when the current value (like the current time) is greater than the specified `value` of the TriggerEvent and the activation state is set as was defined in the TriggerEvents' `active:bool` config variable. Take for exampl ethe following TriggerEvents:
```json
    "dayStartsActive":false,    
    "trigger":[{
        "active":true,
        "type":"time",
        "value":"10:00 AM"
    },{
        "active":false,
        "type":"time",
        "value":"1:00 PM"
    }]
```

Evaluating the sensor at `11:00 PM` yields the following sequence: The evaluation starts with the activation state set to `false` (`"dayStartsActive":false`). Now the first TriggerEvent is calculated. Since `11:00 AM` (the current time) is larger than `10:00 AM` (the `"value":"10:00 AM"` of the TriggerEvent), the event is triggered and sets the activation state to `true`. The second TriggerEvent does not trigger as its value (`1:00 PM`) is less than the current time. The resulting activation state for `11:00 PM` is `true`.

Evaluating the same set of TriggerEvents at `2:00 PM`generates a different activation state. As above, the evaluation starts with the activation state set to `false`. The first TriggerEvent will trigger as before and changes the activation state to `true`. However, the second TriggerEvent will also trigger and finally change the activation state back to `false`. Hence, the resulting activation state for `11:00 PM` is `true`.

In this case the switch will be notified twice a day: 
- At `10:00 AM` when the activation state first changes from `false` to `true`resulting in a **single press**
- At `1:00 PM` when the activation state changes back to `false`resulting in a **double press**

## Web Service
The plugin offers a very simple web interface to force trigger the switch, check and reset the state as well as visualize the activation state of the switch over the day. This is a helpfull tool when debuging a given sequence of TriggerEvents. For example, when using the follwoing config
```json
  "accessories": [{
      "accessory": "DailySensors",
      "name":"My new daily switch",
      "port":7755,
      "dayStartsActive":false,    
      "trigger":[{
            "active":true,
            "type":"altitude",
            "value":"0.03",
            "trigger":"both"
      }],
      "location":{
        "longitude":-0.118092,
        "latitude":51.509865
      }
  }]
```
you may access the web interface through http://[homebridge-ip]:7755/ 

### Visualize TriggerEvents
If you specify a config variable `port`, a web server will be started and bound. If you open the root resource of that server the system will display the activation state of the sensor over the course of the entire day as well as display the results of the Evaluation steps for every minute of the day.

### Force a state change
If you access http://[homebridge-ip]:7755/1 (or http://[homebridge-ip]:7755/0) the switch is triggered with an **on** (**off**) event resulting in a **single press** (**double press**) notification. This locks the state of the switch to the given value until a activation state changes based on the defined rules.

### Clear forced state
If you force a state change as described above, you can restore the normal operation of the switch using  http://[homebridge-ip]:7755/clear

### Query state
You can also query the current state of the switch using http://[homebridge-ip]:7755/state


## Advanced TriggerEvents

### Time

### Altitude

### Lux

### Event

