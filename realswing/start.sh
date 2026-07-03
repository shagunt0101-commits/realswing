#!/bin/bash
# Railway uses this to start the Nubra proxy
# The orchestrator is started as a separate service
uvicorn nubra_backend:app --host 0.0.0.0 --port $PORT
