#!/usr/bin/env python
# Path: octoprint_pidtune\utils.py
# # -*- coding: utf-8 -*-
from __future__ import absolute_import, division, unicode_literals

import json

from octoprint.printer import PrinterCallback

class PidTuneUtils:
    def __init__(self):
       pass

    @staticmethod
    def format_temp_value(temp):
        return "%.1f°C" % temp

    @staticmethod
    def pwm_to_percent(pwm_value: int) -> int:
        return int(pwm_value * (100 / 255))

    def format_fan_speed(self, fan_s) -> int:
        return self.pwm_to_percent(fan_s)

    @staticmethod
    def update_max_temp(newv: float, oldv: float) -> float:
        return max([0, max([newv, oldv])])

    @staticmethod
    def update_min_temp(newv: float, oldv: float) -> float:
        if oldv <= 0:
            return newv
        else:
            return max([0, min([newv, oldv])])

    @staticmethod
    def shift(array):
        return array[1:]
