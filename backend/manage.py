#!/usr/bin/env python3
"""Django 的命令入口：检查、建表、创建管理员、启动服务都从这里开始。"""
import os
import sys

if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)
