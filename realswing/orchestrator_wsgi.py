"""
WSGI entry point for PythonAnywhere — Orchestrator.
"""
import sys, os
path = os.path.dirname(os.path.abspath(__file__))
if path not in sys.path:
    sys.path.insert(0, path)

from orchestrator import app as application
