#!/bin/bash
# Railway uses this to start the orchestrator
# This is a separate service from the Nubra proxy
uvicorn orchestrator:app --host 0.0.0.0 --port $PORT
