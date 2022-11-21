# coding=utf-8
from __future__ import absolute_import

import json
import logging
import re
import traceback
from datetime import datetime
from typing import Optional

import flask
import octoprint.plugin
import octoprint.settings
from octoprint.events import Events
from octoprint.logging.handlers import CleaningTimedRotatingFileHandler
from octoprint.util.json import JsonEncoding


from octoprint_pidtune.parser import Parser
from octoprint_pidtune.plugin_callbacks import PrinterDataCallBack
from octoprint_pidtune.utils import PidTuneUtils

pidtune_plugin_name = "pidtune"


def unfreeze(frozen) -> dict:
    return json.loads(
        json.dumps(frozen, default=JsonEncoding.encode, allow_nan=False).replace(
            "</", "<\\/"
        )
    )


class PidtunePlugin(
    octoprint.plugin.AssetPlugin,
    octoprint.plugin.BlueprintPlugin,
    octoprint.plugin.SettingsPlugin,
    octoprint.plugin.SimpleApiPlugin,
    octoprint.plugin.StartupPlugin,
    octoprint.plugin.TemplatePlugin,
    octoprint.plugin.WizardPlugin,
    octoprint.plugin.EventHandlerPlugin
):

    def __init__(self):

        self._js_logger = None
        self.printer_callback = None
        self.plugin_name = "pidtune"
        self.utils = PidTuneUtils()
        self._logger = logging.getLogger(__name__)
        self.js_errors = []
        # super(PidtunePlugin, self).__init__()
        self.graphColors = ["red", "orange", "lightgreen", "brown",
                            "pink", "purple", "yellow", "blue"]
        self.tg_graphColors = ["#ff8080", "#ffd080", "#c0edc0", "#a36767",
                               "#ffe0e6", "#804080", "#ffff80", "#8080ff"]
        self.fan_graphColors = ["green", "violet", "lightblue", "yellow",
                                "purple", "blue", "darkblue", "darkgreen"]

        self.collecting_data: bool = False

        self.act_temps = None
        self.target_temps = None

        self.min_temp = {}
        self.max_temp = {}
        self.max_target_temp = {}

        self.max_fan_speed = 0
        self.fans_speeds = None
        self.fans_values: Optional[dict] = {}

        self.has_heatedbed: bool = False
        self.hotend_count: int = 0
        self.tempControllers = {}

        self._parser: Optional[Parser] = None

        self._printer_locked: bool = False
        self.isError: bool = False
        self.isErrorOrClosed: bool = False
        self.isLoading: bool = False
        self.isOperational: bool = False
        self.isPaused: bool = False
        self.isPrinting: bool = False
        self.isReady: bool = False

        self.pids_data: Optional[dict] = None

        self.printer_profile = None
        self.started: bool = False

        self.temperature_cutoff: int = 30

        self.h_tm: int = 284
        self.b_tm: int = 110

        self.setting_defaut = dict(
            discord=dict(
                bot_name="Octoprint",
                bot_avatar="",
                wh_url="",
                wh_thumbnails=""
            ),
            temperature_cutoff=30,
            h_tm=284,
            b_tm=110
        )

        self.logger = self._logger

    def setLogger(self):
        try:
            self.plugin_name
        except NameError:
            self.plugin_name = "pidtune"
        else:
            if not self.plugin_name:
                self.plugin_name = "pidtune"
        self.logger = logging.getLogger("octoprint.plugins.%s" % self.plugin_name)
        hdlr = CleaningTimedRotatingFileHandler(
            self._settings.get_plugin_logfile_path(postfix="debug"),
            when="D",
            backupCount=3,
        )
        formater = logging.Formatter("[%(asctime)s] %(levelname)s: %(message)s")
        hdlr.setFormatter(formater)
        self.logger.addHandler(hdlr)
        self.logger.setLevel(
            logging.DEBUG
        )
        self.logger.propagate = False
        return self.logger

    def get_template_configs(self):
        return [
            dict(type="settings", custom_bindings=False)
        ]

    def get_settings(self):
        return self._settings

    def get_assets(self):
        return dict(
            js=["js/jsErrorLogger.js","js/pidtune.js"],
            css=["css/pidtune.css"],
            less=["less/pidtune.less"]
        )

    def get_octoprint_printer_profile(self):
        return self._printer_profile_manager.get_current()

    def get_printer_profile(self):
        self.printer_profile = self._printer_profile_manager.get_current()
        if self.printer_profile:
            temp_dict = {}
            self.has_heatedbed = self.printer_profile["heatedBed"]
            self.hotend_count = self.printer_profile["extruder"]["count"]
            self._parser = Parser(self.logger, self.has_heatedbed, self.hotend_count)
            self.getCurrentSettings()
            if self.hotend_count > 0:
                for extruder in range(0, self.hotend_count):
                    temp_dict.update({extruder: "Tool%s" % str(extruder)})
            if self.has_heatedbed:
                temp_dict.update({-1: "Bed"})
            self.tempControllers = temp_dict
            self.act_temps = {}
            self.target_temps = {}
            self.fans_speeds = {}
            for t in temp_dict:
                self.act_temps.update({t: []})
                self.target_temps.update({t: []})
            self.fans_values = {0: 0}

    def get_setting(self, setting_k):
        return octoprint.settings.settings().get(["discordbot", setting_k])

    def get_version(self):
        return self._plugin_version

    def get_update_information(self):
        return dict(
            pidtune=dict(
                displayName="Pidtune Plugin",
                displayVersion=self._plugin_version,
                # version check: github repository
                type="github_commit",
                user="ketchu13",
                repo="OctoPrint-Pidtune",
                current=self._plugin_version,

                # update method: pip
                pip="https://github.com/ketchu13/OctoPrint-Pidtune/archive/{target_version}.zip"
            )
        )

    def get_api_commands(self):
        return {
            "jd_error"               : ["data"],
            "pid_autotune"           : ["data"],
            "update"                 : ["data"],
            "getpid"                 : ["tool"],
            "loadbackup"             : ["bckp_file"],
            "getbackup"              : ["bckp_file"],
            "printer_profile_updated": [],
            "process_state_data"     : [],
            "process_logs_data"      : ["data"],
            "process_temp_data"      : [],
            "process_data"           : [],
            "getbackuplist"          : []
        }

    def get_settings_defaults(self):
        return self.setting_defaut

    @staticmethod
    def is_wizard_required(**kwargs) -> bool:
        return False

    def on_event(self, event, payload):
        self.logger.debug("event", event, payload)
        try:
            if event == Events.PRINTER_STATE_CHANGED:
                self.logger.debug("payload")
                self.logger.debug(payload)
            elif event == Events.SETTINGS_UPDATED:
                self.logger.debug("SETTINGS_UPDATED")

        except Exception as e:
            self.logger.exception("An error occurred while handling an OctoPrint event.")
            raise e

    def on_after_startup(self):
        self.logger = self.setLogger()
        self.logger.info("=========================")
        self.logger.info("Starting PIDTune")
        self.printer_callback = PrinterDataCallBack(self.logger, self.process_current_data)
        self._printer.register_callback(self.printer_callback)
        if not self.utils:
            self.utils = PidTuneUtils()

        self.get_printer_profile()

        self.getCurrentSettings()

        settings = self.get_settings_defaults()
        for index in settings:
            settings[index] = self._settings.get([index])
            self.logger.debug("Settings for {}: {}".format(index, settings[index]))

        self._parser = Parser(self.logger, self.has_heatedbed, self.hotend_count)

        self._js_logger = logging.getLogger("octoprint.JsFrontendErrors(PIDTune)")
        hdlr = CleaningTimedRotatingFileHandler(
            self._settings.get_plugin_logfile_path(postfix="debug"),
            when="D",
            backupCount=3,
        )
        formater = logging.Formatter("[%(asctime)s] %(levelname)s: %(message)s")
        hdlr.setFormatter(formater)
        self._js_logger.addHandler(hdlr)
        self._js_logger.setLevel(
            logging.DEBUG
        )
        self._js_logger.propagate = False
        self._js_logger.info("Js Logger (PIDTune) started")
        self.logger.debug("JS Logger started")

        self.logger.info("PIDTune plugin started")
        self.logger.info("=========================")
        self.started = True

    def on_shutdown(self):
        self.logger.info("PIDTune plugin stopped")
        self.logger.info("=========================")
    def get_min_max_tools_value(self):
        max_temp = 0.0
        for _, temp in self.max_temp.items():
            if max_temp == 0 or temp > max_temp:
                max_temp = temp

        max_t_temp = 0.0
        for _, t_temp in self.max_target_temp.items():
            if max_t_temp == 0 or t_temp > max_t_temp:
                max_t_temp = t_temp

        for _, speed in self.fans_values.items():
            if self.max_fan_speed == 0 or int(speed) > self.max_fan_speed:
                self.max_fan_speed = int(speed)

        return max([max_temp, max_t_temp, self.max_fan_speed])

    def on_api_command(self, command, data):
        if command == "js_error":
            if isinstance(data, dict):
                self.logger.error("JS Error: {}".format(json.dumps(data, indent=4, sort_keys=True)))
            elif isinstance(data, str):
                self.logger.error("JS Error: {}".format(data))
            if data not in self.js_errors:
                self.js_errors.append(data)
                self.logger.error(
                    "Frontend javascript error detected (this error is not necesarily to do with dashboard):\n{msg}".format(**data)
                )
                self._js_logger.error(data)

        if command == "pid_autotune":
            if "command" in data:
                self._printer.commands([data["command"]])
                return flask.jsonify({"success": True, "data": '{"data": "ok"}'})
            else:
                return flask.jsonify({"success": False, "error": '{"data": "error"}'})

        """Update current printer profile"""
        if command == "printer_profile_updated":
            self.get_printer_profile()
            if self.printer_profile:
                return flask.jsonify({"success": True, "data": json.dumps(self.tempControllers)})
            return flask.jsonify({"success": False, "error": "Profile is none."})

        """Get data for graph update"""
        if command == "update":
            data_tsd = self.updateplot()
            if data_tsd:
                tp_dt = { "data": data_tsd }
                dtf = json.dumps(tp_dt)
                return flask.jsonify({"success": True, "data": dtf})
            return flask.jsonify({"success": False, "error": "no actual temp."})

        """Process full data for debuging"""
        if command == "process_data":
            self.process_data(data)
            dtf = json.dumps(data)
            return flask.jsonify({"success": True, "data": dtf})

        """Process data for printer' state update"""
        if command == "process_state_data":
            # self.process_state_data(data)
            dtf = json.dumps(data)
            return flask.jsonify({"success": True, "data": dtf})

        """Parse terminal' logs"""
        if command == "process_logs_data":
            self.process_logs_data(data)
            dtf = json.dumps(data)
            return flask.jsonify({"success": True, "data": dtf})

        """Parse temperatures logs"""
        if command == "process_temp_data":
            #self.process_temp_data(data)
            dtf = json.dumps(data)
            return flask.jsonify({"success": True, "data": dtf})

    def on_api_get(self, request):
        return flask.jsonify(self._parser.get_pids_data())  # TODO

    def on_settings_save(self, data):
        octoprint.plugin.SettingsPlugin.on_settings_save(self, data)
        self.logger.info("Settings saved")
        self.logger.info("=========================")
        self.getCurrentSettings()

    def getCurrentSettings(self):
        tco = self.get_settings().get(['temperature_cutoff'])
        htm = self.get_settings().get(['h_tm'])
        btm = self.get_settings().get(['b_tm'])

        self.temperature_cutoff = int(tco) if tco else 0
        self.h_tm = int(htm) if htm else 0
        self.b_tm = int(btm) if btm else 0

    def updateplot(self):
        datat = []
        for tool in self.tempControllers:

            if self.act_temps[tool] and (len(self.act_temps[tool]) > 0):
                self.act_temps[tool].sort()
                actual_temp = self.utils.format_temp_value(self.act_temps[tool][len(self.act_temps[tool]) - 1][1])
            else:
                return datat

            current_target_temp = "-"
            if self.target_temps[tool] and (len(self.target_temps[tool]) > 0):
                self.target_temps[tool].sort()
                current_target_temp = self.utils.format_temp_value(self.target_temps[tool][len(self.target_temps[tool]) - 1][1])

            datat.append(
                {
                    "label": "%s Actual: %s" % (self.tempControllers[tool], str(actual_temp)),
                    "color": self.graphColors[tool],
                    "data" : self.act_temps[tool]
                }
            )

            datat.append(
                {
                    "label": "%s Target: %s" % (self.tempControllers[tool], str(current_target_temp)),
                    "color": self.tg_graphColors[tool],
                    "data" : self.target_temps[tool]
                }
            )
        for f_idx, _ in self.fans_values.items():
            if self.fans_speeds[f_idx] and (len(self.fans_speeds[f_idx]) > 0):
                self.fans_speeds[f_idx].sort()
                actual_fan_speed = self.fans_speeds[f_idx][len(self.fans_speeds[f_idx]) - 1][1]
                datat.append(
                    {
                        "label": "Fan%s : %s%%" % (str(f_idx), str(actual_fan_speed)),
                        "color": self.fan_graphColors[f_idx],
                        "data" : self.fans_speeds[f_idx]
                    }
                )
        return datat

    def process_current_data(self, data):
        self.process_temp_data(data)
        self.process_state_data(data)
        self.process_logs_data(data)
        self.process_data(data)

    def process_data(self, data):

        """self.logger.debug("process_data_client_time")
            {
                "command": "process_data",
                "data": {
                    "busyFiles": [],
                    "currentZ": null,
                    "job": {
                        "estimatedPrintTime": null,
                        "filament": {
                            "length": null,
                            "volume": null
                        },
                        "file": {
                            "date": null,
                            "name": null,
                            "origin": null,
                            "path": null,
                            "size": null
                        },
                        "lastPrintTime": null,
                        "user": null
                    },
                    "logs": [
                        "Recv: Not SD printing"
                    ],
                    "markings": [],
                    "messages": [
                        "Not SD printing"
                    ],
                    "offsets": {},
                    "progress": {
                        "completion": null,
                        "filepos": null,
                        "printTime": null,
                        "printTimeLeft": null,
                        "printTimeOrigin": null
                    },
                    "resends": {
                        "count": 0,
                        "ratio": 0,
                        "transmitted": 11
                    },
                    "serverTime": 1668541147.5809927,
                    "state": {
                        "error": "",
                        "flags": {
                            "cancelling": false,
                            "closedOrError": false,
                            "error": false,
                            "finishing": false,
                            "operational": true,
                            "paused": false,
                            "pausing": false,
                            "printing": false,
                            "ready": true,
                            "resuming": false,
                            "sdReady": true
                        },
                        "text": "Operational"
                    },
                    "temps": []
                }
            }

        self.logger.debug("process_data_temperature_cutoff")
        self.logger.debug(data["temperature_cutoff"])
        self.temperature_cutoff = data["temperature_cutoff"]"""

    def process_logs_data(self, data):
        pass
        """self.logger.debug("process_logs_data_client_time")
        self.logger.debug(data["client_time"])
        self.logger.debug("process_logs_data_temperature_cutoff")
        self.logger.debug(data["temperature_cutoff"])
        self.temperature_cutoff = data["temperature_cutoff"]"""

    def process_temp_data(self, data):
        if self.started:
            if not self.printer_profile:
                self.get_printer_profile()
            if self.printer_profile and "data" in data and "temps" in data["data"]:
                client_time = datetime.now().timestamp()
                for x in data["data"]["temps"]:
                    if "serverTime" in data["data"] and "time" in x:
                        time_diff = data["data"]["serverTime"] - (x["time"] * 1000)
                        time_ = int(client_time - time_diff)
                        tool_index = None
                        for k, v in x.items():
                            if k != "time":
                                logmatch = re.compile("^(tool)(?P<tool_index>\d+)").match(k)
                                if logmatch:
                                    tool_index = int(logmatch.group("tool_index"))

                                logmatch2 = re.compile("^(bed)").match(k)
                                if logmatch2:
                                    tool_index = -1

                                if logmatch2 or logmatch:
                                    obj_actual = [time_, v["actual"]]
                                    obj_target = [time_, v["target"]]

                                    if len(self.act_temps[tool_index]) > 0:
                                        if (client_time - (int(self.act_temps[tool_index][0][0]) / 1000)) >= (self.temperature_cutoff * 60):
                                            self.act_temps[tool_index] = self.utils.shift(self.act_temps[tool_index])
                                    if len(self.target_temps[tool_index]) > 0:
                                        if (client_time - (int(self.target_temps[tool_index][0][0]) / 1000)) >= (self.temperature_cutoff * 60):
                                            self.target_temps[tool_index] = self.utils.shift(self.target_temps[tool_index])

                                    if obj_actual not in self.act_temps[tool_index]:
                                        self.act_temps[tool_index].append(obj_actual)
                                    if obj_target not in self.target_temps[tool_index]:
                                        self.target_temps[tool_index].append(obj_target)

                                    for f_idx, f_v in self.fans_values.items():
                                        if len(self.fans_speeds) > 0 and f_idx in self.fans_speeds:
                                            if len(self.fans_speeds[f_idx]) > 0:
                                                if (client_time - (int(self.fans_speeds[f_idx][0][0]) / 1000)) >= (self.temperature_cutoff * 60):
                                                    self.fans_speeds[f_idx] = self.utils.shift(self.fans_speeds[f_idx])
                                        else:
                                            self.fans_speeds[f_idx] = []
                                        self.fans_speeds[f_idx].append([time_, self.fans_values[f_idx]])

                                    """===========min / max========="""
                                    if tool_index in self.min_temp:
                                        min_temp = self.min_temp[tool_index]
                                    else:
                                        self.min_temp[tool_index] = 0.0
                                        min_temp = 0.0
                                    if tool_index in self.max_temp:
                                        max_temp = self.max_temp[tool_index]
                                    else:
                                        self.max_temp[tool_index] = 0.0
                                        max_temp = 0.0

                                    if tool_index in self.max_target_temp:
                                        max_t_temp = self.max_target_temp[tool_index]
                                    else:
                                        self.max_target_temp[tool_index] = 0.0
                                        max_t_temp = 0.0

                                    self.min_temp[tool_index] = self.utils.update_min_temp(obj_actual[1], min_temp)
                                    self.max_temp[tool_index] = self.utils.update_max_temp(obj_actual[1], max_temp)
                                    self.max_target_temp[tool_index] = self.utils.update_max_temp(obj_target[1], max_t_temp)

    @staticmethod
    def format_data(data):
        return unfreeze(data)

    def process_state_data(self, data):
        if "data" in data and "state" in data["data"] and "flags" in data["data"]["state"]:
            self.isErrorOrClosed = None
            self.isOperational = None
            self.isPaused = None
            self.isPrinting = None
            self.isError = None
            self.isReady = None
            self.isLoading = None

            if "error" in data["data"]["state"]["flags"]:
                self.isError = data["data"]["state"]["flags"]["error"]
            if "closedOrError" in data["data"]["state"]["flags"]:
                self.isErrorOrClosed = data["data"]["state"]["flags"]["closedOrError"]
            if "operational" in data["data"]["state"]["flags"]:
                self.isOperational = data["data"]["state"]["flags"]["operational"]
            if "paused" in data["data"]["state"]["flags"]:
                self.isPaused = data["data"]["state"]["flags"]["paused"]
            if "printing" in data["data"]["state"]["flags"]:
                self.isPrinting = data["data"]["state"]["flags"]["printing"]
            if "ready" in data["data"]["state"]["flags"]:
                self.isReady = data["data"]["state"]["flags"]["ready"]
            if "loading" in data["data"]["state"]["flags"]:
                self.isLoading = data["data"]["state"]["flags"]["loading"]

    def send_plugin_errors(self, message_type, errors):
        self._plugin_manager.send_plugin_message(
            self._identifier, dict(type=message_type, errors=errors)
        )

    def send_plugin_message(self, message_type, msg):
        self._plugin_manager.send_plugin_message(
            self._identifier, dict(type=message_type, msg=msg)
        )

    def send_message(self, type_, data_):
        payload = {"type": type_, "data": data_}
        self._plugin_manager.send_plugin_message("pidtune", payload)

    def comm_protocol_gcode_received(self, comm, line, *args, **kwargs):
        try:
            if self.started:
                self.parse_pid_gcode(line=line)
        except Exception as ex:
            self.logger.error("comm_protocol_gcode_received")
            self.logger.error(ex)
            self.logger.error(traceback.format_exc())
        return line

    def comm_protocol_gcode_sent(self, comm, phase, cmd, cmd_type, gcode, subcode=None, tags=None, *args, **kwargs):
        try:
            if self.started:
                self.parse_gcode(cmd, gcode)
        except Exception as ex:
            self.logger.error("comm_protocol_gcode_sent")
            self.logger.error(ex)
            self.logger.error(traceback.format_exc())

    def comm_protocol_gcode_queueing(self, comm, phase, cmd, cmd_type, gcode, subcode=None, tags=None, *args, **kwargs):
        if gcode and gcode == "M107":
            cmd = []
            if len(self.fans_values) <= 1:
                cmd.append("M106 S0")
            else:
                if len(self.fans_values) <= 0:
                    self.fans_values[0] = 0
                if len(self.fans_values) == 1:
                    self.fans_values[0] = 0
                    cmd.append("M106 S0")
                if len(self.fans_values) > 1:
                    for fan_idx, _ in self.fans_values.items():
                        self.fans_values[fan_idx] = 0
                        cmd.append("M106 P%s S0" % str(fan_idx))
        return cmd

    def parse_gcode(self, cmd, gcode=None):
        if not self.started:
            return
        if not self.printer_profile:
            self.get_printer_profile()

        cmd = cmd.replace("\n", "").replace("\r", "").strip()
        if not cmd.startswith(";") and self.printer_profile and len(cmd) > 2:
            if "printer locked" in cmd.lower():
                self.send_message("locked", {})
                self._printer_locked = True
                # Disable data collection
                self.collecting_data = False

            if gcode and gcode == "M303":
                self._parser.auto_state_pid("started")
                commandheater_match = re.compile(self._parser.reReqPid).match(cmd)
                if commandheater_match:
                    if "tool_index" in commandheater_match.groupdict():
                        self._parser.current_heater = int(commandheater_match.group("tool_index"))
            # get target tool pid
            if gcode and (gcode == "M301" or gcode == "M304"):
                if gcode == "M301":
                    load_pid_cmd = re.compile(self._parser.reLoadToolPid).match(cmd)
                    if load_pid_cmd and "tool_index" in load_pid_cmd.groupdict():
                        self._parser.current_heater = int(load_pid_cmd.group("tool_index"))
                else:
                    self._parser.current_heater = -1

            if gcode and gcode == "M106":
                fan_value = re.compile("M106\s+(P(?P<index>\d*)\s+)?S(?P<value>\d*)").match(cmd)
                value = 255
                index = 0
                if fan_value:
                    if "index" in fan_value.groupdict():
                        index = fan_value.group("index")
                        if index and len(index) >= 1 and isinstance(index, str) and index.isdigit():
                            index = int(index)

                    if "value" in fan_value.groupdict():
                        value = fan_value.group("value")
                        if value and len(value) >= 1 and isinstance(value, str) and value.isdigit():
                            value = int(value)

                    index = index if index else 0
                    value = value if value else 0

                self.fans_values[index] = self.utils.format_fan_speed(value)

            if gcode and gcode == "M107":
                for x in self.fans_values:
                    self.fans_values[x] = 0

    def parse_pid_gcode(self, line, force: bool = False):
        if not self.printer_profile: self.get_printer_profile()
        gcode = re.compile(self._parser.regex_command).match(line)
        if gcode and "gcode" in gcode.groupdict() and (gcode.group("gcode") == "M106" or gcode.group("gcode") == "M107"):
            self.parse_gcode(line, gcode.group("gcode"))
        elif self.printer_profile and self._parser.parse_pid_data(line):
            try:
                self.send_message("piddata", self._parser.json_pids_data)
            except Exception as ex:
                self.logger.error(ex)
                self.logger.error(traceback.format_exc())

    def PIDAutoTuning(self, heater: str, temp, cycles):
        if not self.started:
            return
        if not self.printer_profile:
            self.get_printer_profile()

        if self.printer_profile:
            if heater in self.tempControllers:
                if not self._printer.is_printing() and not self._printer.is_paused() and self._printer.is_operational():
                    heater_index = -1
                    if heater.lower() != "bed": heater_index = heater[-1]
                    self._printer.commands("M303 E{} S{} U{}".format(heater_index, temp, cycles))
            else:
                self.logger.debug("Heater {} not found in printer profile".format(heater))


__plugin_name__ = "PIDtune"
__plugin_pythoncompat__ = ">=2.7,<4"


def __plugin_load__():
    global __plugin_implementation__
    __plugin_implementation__ = PidtunePlugin()
    plugin = __plugin_implementation__

    global __plugin_hooks__
    __plugin_hooks__ = {
        "octoprint.plugin.softwareupdate.check_config": plugin.get_update_information,
        "octoprint.comm.protocol.gcode.sent"          : plugin.comm_protocol_gcode_sent,
        "octoprint.comm.protocol.gcode.received"      : plugin.comm_protocol_gcode_received,
        # "octoprint.comm.protocol.atcommand.sending"   : plugin.comm_protocol_atcommand_sending,
    }
