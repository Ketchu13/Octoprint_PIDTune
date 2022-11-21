# -*- coding: utf-8 -*-
from __future__ import absolute_import, division, unicode_literals

from typing import Optional

"""
Provide methods for parsing printer communication, specific to this plugin
"""
__license__ = "GNU Affero General Public License http://www.gnu.org/licenses/agpl.html"
__copyright__ = (
    "Copyright (C) 2022 Nicolas Grimaud - Released under terms of the AGPLv3 License"
)

import re

class PIDData:
    def __init__(self, logger):
        self.p = None
        self.i = None
        self.d = None
        self.ku = None
        self.tu = None
        self.kp = None
        self.ki = None
        self.kd = None
        self.name = None
        self._type_ = None
        self.bias = None
        self.min = None
        self.max = None
        self._logger = logger


class PIDBedData(PIDData):
    def __init__(self, logger):
        super().__init__(logger)
        self.name = "HB"
        self._type_ = "bed"


class PIDToolData(PIDData):
    def __init__(self, logger, index: int = 0, name=None):
        super().__init__(logger)
        self.index = index
        self.name = ("E%d" % index) if not name else name
        self._type_ = "hotend"


class Parser:
    re_pid = "^(Recv:)?(\s+echo:)?\s+(?P<tool>e:(?P<e_index>\d+)?\s+)(p:(?P<p>\d+\.?\d*)\s+)(i:(?P<i>\d+\.?\d*)\s+)(d:(?P<d>\d+\.?\d*)\s+).*"
    re_tool_pid = "^(Recv:)?(\s+echo:)?\s+M301\s+(P(?P<P>\d+\.?\d*)\s+)(I(?P<I>\d+\.?\d*)\s+)(D(?P<D>\d+\.?\d*)\s+).*"
    reLoadToolPid = "^(Recv:)?(\s+echo:)?\s+M301\s+(E(?P<tool_index>\-?\d+)\s+).*"

    reBedlPid = "^(Recv:)?(\s+echo:)?\s+M304\s+(P(?P<P>\d+\.?\d*)\s+)(I(?P<I>\d+\.?\d*)\s+)(D(?P<D>\d+\.?\d*)\s+).*"
    reReqPid = "^(Recv:)?(\s+echo:)?\s+M303\s+(E(?P<tool_index>\-?\d+)\s+)(C(?P<cycles>\-?\d+)\s+)?(S(?P<temp_tgt>\-?\d+)\s+)?.*"
    reTuneStat = "^(Recv:)?\s+(bias:\s*(?P<bias>\d+\.?\d*)\s+)(d:\s*(?P<d>\d+\.?\d*)\s+)(min:\s*(?P<min>\d+\.?\d*)\s+)(max:\s*(?P<max>\d+\.?\d*)).*"
    reTuneParam = "^(Recv:)?.+(Ku:\s*(?P<ku>\d+\.?\d*)\s+)(Tu:\s*(?P<tu>\d+\.?\d*)).*"
    reTuneComplete = "^(Recv:)?\s+PID Autotune finished.*"
    reTuneFailed = "^(Recv:)?\s+PID Autotune failed.*"
    reFanSpeed = "^(Recv:)?\s+Fan\(s\)\s+Speed:\s+Fan(?P<fan_index>\d+)=\s*?(?P<value>\d+).*"
    regex_command = "\s*(?P<gcode>M(?P<value>\d{1,3}))"

    def __init__(self, logger, has_heatedbed: bool = True, hotend_count: int = 1):
        self.json_pids_data = None
        self.current_heater = 0
        self.has_heatedbed = has_heatedbed
        self.hotend_count = hotend_count
        self._logger = logger
        self.pid_auto_state: Optional[str] = None
        self.__pids_data = {"tools": {}}
        if self.has_heatedbed:
            self.__pids_data["tools"][-1] = PIDBedData(self._logger)
        if self.hotend_count >= 1:
            for index in range(0, hotend_count):
                self.__pids_data["tools"][index] = PIDToolData(logger=self._logger, index=index, name="E%d" % index)

    def parse_pid_data(self, line: str) -> bool:
        updates_pid = False
        if self.pid_auto_state == "started":
            logs_match = re.compile(self.reTuneStat).match(line)
            if logs_match:
                self.__pids_data["tools"][self.current_heater].bias = float(logs_match.group("bias"))
                self.__pids_data["tools"][self.current_heater].min  = float(logs_match.group("min"))
                self.__pids_data["tools"][self.current_heater].max  = float(logs_match.group("max"))
                updates_pid = True

            logs_match = re.compile(self.reTuneParam).match(line)
            if logs_match:
                self.__pids_data["tools"][self.current_heater].ku = float(logs_match.group("ku"))
                self.__pids_data["tools"][self.current_heater].tu = float(logs_match.group("tu"))
                updates_pid = True

            logs_match = re.compile(self.reTuneComplete).match(line)
            if logs_match:
                self.auto_state_pid("completed")
                updates_pid = True

            logs_match = re.compile(self.reTuneFailed).match(line)
            if logs_match:
                self.auto_state_pid("failed")
                updates_pid = True

        logs_match = re.compile(self.reBedlPid).match(line)
        if logs_match:
            self.__pids_data["tools"][-1].kp = float(logs_match.group("P"))
            self.__pids_data["tools"][-1].ki = float(logs_match.group("I"))
            self.__pids_data["tools"][-1].kd = float(logs_match.group("D"))
            updates_pid = True

        logs_match = re.compile(self.re_tool_pid).match(line)
        if logs_match:
            self.__pids_data["tools"][self.current_heater].kp = float(logs_match.group("P"))
            self.__pids_data["tools"][self.current_heater].ki = float(logs_match.group("I"))
            self.__pids_data["tools"][self.current_heater].kd = float(logs_match.group("D"))
            updates_pid = True

        logs_match = re.compile(self.re_pid).match(line)
        if logs_match:
            self.__pids_data["tools"][self.current_heater].kp = float(logs_match.group("P"))
            self.__pids_data["tools"][self.current_heater].ki = float(logs_match.group("I"))
            self.__pids_data["tools"][self.current_heater].kd = float(logs_match.group("D"))
            updates_pid = True

        # construct response
        if updates_pid:
            self._logger.debug("updates_pid")
            dico_d = {}
            if self.__pids_data and "tools" in self.__pids_data:
                for t in self.__pids_data["tools"]:
                    dico_d[t] = {k: v for k, v in self.__pids_data["tools"][t].__dict__.items() if k[0] != "_"}
            if len(dico_d) >= 1:
                self.json_pids_data = dico_d
                return True
        return False

    def get_pids_data(self) -> dict:
        dico_d = {}
        if self.__pids_data and "tools" in self.__pids_data:
            for t in self.__pids_data["tools"]:
                dico_d[t] = {k: v for k, v in self.__pids_data["tools"][t].__dict__.items() if k[0] != "_"}
        if len(dico_d) >= 1:
            self.json_pids_data = dico_d
        return self.json_pids_data

    def auto_state_pid(self, state: Optional[str] = None):
        if state and len(state) > 3:
            self.pid_auto_state = state
        return self.pid_auto_state

    """def get_pids(self):
        return self.__pids_data

    
    
    def set_pids(self, pids_data_json):
        for key, value in pids_data_json["tool"].items():
            if str(key) == "-1":
                self.__pids_data["tool"][key] = PIDBedData(self._logger)
            else:
                self.__pids_data["tool"][key] = PIDToolData(self._logger, int(key))
                for k, v in value.items():
                    setattr(self.__pids_data["tool"][key], k, v)
        return self.__pids_data

    @staticmethod
    def is_marlin(name):
        return "marlin" in name.lower()"""
