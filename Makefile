PYTHON := .venv/bin/python
PIP := .venv/bin/pip
FRONTEND_DIR := frontend

.PHONY: install test validate regression frontend-lint frontend-build server dev

install:
	python3 -m venv .venv
	$(PIP) install -r requirements.txt

test:
	$(PYTHON) -m unittest discover -s tests

validate:
	$(PYTHON) scripts/validate_workflow.py

regression:
	$(PYTHON) scripts/regression.py

frontend-lint:
	npm --prefix $(FRONTEND_DIR) run lint

frontend-build:
	npm --prefix $(FRONTEND_DIR) run build

server:
	$(PYTHON) scripts/run_engine_server.py

dev:
	$(PYTHON) scripts/run_engine_server.py
