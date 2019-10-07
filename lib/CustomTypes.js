const inherits = require('util').inherits
let CustomTypes = undefined;

module.exports = function(Service, Characteristic, UUID){
    if (CustomTypes===undefined){
        console.log("AAAAA", UUID.generate('EMPTS'));
        const modeUUID = UUID.generate('CustomTypes:usagedevice:LightMode');
        const labelUUID = UUID.generate('CustomTypes:usagedevice:LightModeLabel');

        class LightMode extends Characteristic {
            constructor() {
                super('Light Mode', modeUUID);
                
                this.setProps({
                  format: Characteristic.Formats.UINT8,
                  maxValue: 16,
                  minValue: 0,
                  minStep: 1,
                  perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
                });
                this.value = this.getDefaultValue();
              }  
        };
        LightMode.UUID = modeUUID;

        class LightModeLabel extends Characteristic {            
            constructor() {
                super('Light Mode Label', labelUUID);
                
                this.setProps({
                    format:   Characteristic.Formats.String,
                    perms:    [ Characteristic.Perms.READ, Characteristic.Perms.NOTIFY ]
                });
                this.value = this.getDefaultValue();
              }  
        };
        LightModeLabel.UUID = labelUUID;
        CustomTypes = {LightMode:LightMode, LightModeLabel:LightModeLabel};


        console.log(CustomTypes.LightMode.UUID, labelUUID, modeUUID);
    }

    return CustomTypes;
}