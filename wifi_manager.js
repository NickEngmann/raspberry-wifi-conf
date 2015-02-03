var _       = require("underscore")._,
    async   = require("async"),
    fs      = require("fs"),
    exec    = require("child_process").exec,
    util    = require("util"),
    config  = require("./config.json");

// Better template format
_.templateSettings = {
    interpolate: /\{\{(.+?)\}\}/g,
    evaluate :   /\{\[([\s\S]+?)\]\}/g
};

// Helper function to write a given template to a file based on a given
// context
function write_template_to_file(template_path, file_name, context, callback) {
    async.waterfall([

        function read_template_file(next_step) {
            fs.readFile(template_path, {encoding: "utf8"}, next_step);
        },

        function update_file(file_txt, next_step) {
            var template = _.template(file_txt);
            fs.writeFile(file_name, template(context), next_step);
        }

    ], callback);
}

/*****************************************************************************\
    Return a set of functions which we can use to manage and check our wifi
    connection information
\*****************************************************************************/
module.exports = function() {

    // Hack: this just assumes that the outbound interface will be "wlan0"

    // Define some globals
    var ifconfig_fields = {
        "hw_addr":         /HWaddr\s([^\s]+)/,
        "inet_addr":       /inet addr:([^\s]+)/,
    },  iwconfig_fields = {
        "ap_addr":         /Access Point:\s([^\s]+)/,
        "ap_ssid":         /ESSID:\"([^\"]+)\"/,
    },  last_wifi_info = null;

    // TODO: rpi-config-ap hardcoded, should derive from a constant

    // Get generic info on an interface
    var _get_wifi_info = function(callback) {
        var output = {
            hw_addr: "<unknown>",
            inet_addr: "<unknown>",
        };

        // Inner function which runs a given command and sets a bunch
        // of fields
        function run_command_and_set_fields(cmd, fields, callback) {
            exec(cmd, function(error, stdout, stderr) {
                if (error) return callback(error);
                for (var key in fields) {
                    re = stdout.match(fields[key]);
                    if (re && re.length > 1) {
                        output[key] = re[1];
                    }
                }
                callback(null);
            });
        }

        // Run a bunch of commands and aggregate info
        async.series([
            function run_ifconfig(next_step) {
                run_command_and_set_fields("ifconfig wlan0", ifconfig_fields, next_step);
            },
            function run_iwconfig(next_step) {
                run_command_and_set_fields("iwconfig wlan0", iwconfig_fields, next_step);
            },
        ], function(error) {
            last_wifi_info = output;
            return callback(error, output);
        });
    },

    // Wifi related functions
    _is_wifi_enabled_sync = function(info) {
        if (!_is_ap_enabled_sync(info) &&
            info["inet_addr"] != "<unknown>") {
            return info["inet_addr"];
        }
        return null;
    },

    _is_wifi_enabled = function(callback) {
        _get_wifi_info(function(error, info) {
            if (error) return callback(error, null);
            // If we are not an AP, and we have a valid
            // inet_addr - wifi is enabled!
            var ap_enabled_addr = _is_ap_enabled_sync(info);
            if (ap_enabled_addr == null && info["inet_addr"] != "<unknown>") {
                return callback(null, info["inet_addr"]);
            }
            return callback(null, null);
        });
    },

    // Access Point related functions
    _is_ap_enabled_sync = function(info) {
        is_ap  =
            info["hw_addr"].toLowerCase() == info["ap_addr"].toLowerCase() &&
            info["ap_ssid"] == "rpi-config-ap";
        return (is_ap) ? info["hw_addr"].toLowerCase() : null;
    },

    _is_ap_enabled = function(callback) {
        _get_wifi_info(function(error, info) {
            if (error) return callback(error, null);
            // If the hw_addr matches the ap_addr
            // and the ap_ssid matches "rpi-config-ap"
            // then we are in AP mode
            var is_ap =
                info["hw_addr"].toLowerCase() == info["ap_addr"].toLowerCase() &&
                info["ap_ssid"] == "rpi-config-ap",
                output = (is_ap) ? info["hw_addr"].toLowerCase() : null;
            return callback(null, output);
        });
    },

    // Enables the accesspoint w/ bcast_ssid. This assumes that both
    // isc-dhcp-server and hostapd are installed using:
    // $sudo npm run-script provision
    _enable_ap_mode = function(bcast_ssid, callback) {
        _is_ap_enabled(function(error, result_addr) {
            if (error) return callback(error);

            if (result_addr) {
                console.log("Access point is enabled with ADDR: " + result_addr);
                //return callback(null);
            }

            var context = config.access_point;
            context["enable_ap"] = true;

            // Here we need to actually follow the steps to enable the ap
            async.series([

                // Enable the access point ip and netmask + static
                // DHCP for the wlan0 interface
                function update_interfaces(next_step) {
                    write_template_to_file(
                        "./assets/etc/network/interfaces.ap.template",
                        "/etc/network/interfaces",
                        context, next_step);
                },

                // Enable DHCP conf, set authoritative mode and subnet
                function update_dhcpd(next_step) {
                    var context = config.access_point;
                    // We must enable this to turn on the access point


                    write_template_to_file(
                        "./assets/etc/dhcp/dhcpd.conf.template",
                        "/etc/dhcp/dhcpd.conf",
                        context, next_step);
                },

                // Enable the interface in the dhcp server
                function update_dhcp_interface(next_step) {
                    write_template_to_file(
                        "./assets/etc/default/isc-dhcp-server.template",
                        "/etc/default/isc-dhcp-server",
                        context, next_step);
                },

                // Enable hostapd.conf file
                function update_hostapd(next_step) {
                    write_template_to_file(
                        "./assets/etc/hostapd/hostapd.conf.template",
                        "/etc/hostapd/hostapd.conf",
                        context, next_step);
                }

            ], callback);
        });
    },

    // Disables AP mode and reverts to wifi connection
    _disable_ap_mode = function(wifi_connection_info, callback) {
        console.log("TODO: _disable_ap_mode");
        callback(null);
    };



    return {
        get_wifi_info:        _get_wifi_info,

        is_wifi_enabled:      _is_wifi_enabled,
        is_wifi_enabled_sync: _is_wifi_enabled_sync,

        is_ap_enabled:        _is_ap_enabled,
        is_ap_enabled_sync:   _is_ap_enabled_sync,

        enable_ap_mode:       _enable_ap_mode,
    };
}