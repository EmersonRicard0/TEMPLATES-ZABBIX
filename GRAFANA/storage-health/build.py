#!/usr/bin/env python3
"""Gera ../storage-health-dashboard.json a partir de html.html, style.css, onRender.js e codeData.json."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'storage-health-dashboard.json')
ITEM_REGEX = '/^(SSD .*: .*|Slot .*: (Erros de midia|Outros erros|Falhas previstas)|BBU .*: (Carga|Temperatura))$/'
HOST_REGEX = '/.*/'
DS = {'type': 'alexanderzobnin-zabbix-datasource', 'uid': '${DS_ZABBIX}'}


def read(name):
    with open(os.path.join(HERE, name), encoding='utf-8') as f:
        return f.read()


def target(ref, query_type, item_filter, **extra):
    t = {
        'refId': ref,
        'datasource': DS,
        'queryType': query_type,
        'group': {'filter': '/.*/'},
        'host': {'filter': HOST_REGEX},
        'application': {'filter': ''},
        'itemTag': {'filter': ''},
        'item': {'filter': item_filter},
        'proxy': {'filter': ''},
        'trigger': {'filter': ''},
        'tags': {'filter': ''},
        'functions': [],
        'options': {
            'showDisabledItems': False,
            'skipEmptyValues': False,
            'disableDataAlignment': True,
            'useZabbixValueMapping': False,
            'useTrends': 'default',
        },
        'table': {'skipEmptyValues': False},
        'triggers': {'acknowledged': 2, 'count': True, 'minSeverity': 3},
        'textFilter': '',
        'useCaptureGroups': False,
        'evaltype': '0',
    }
    t.update(extra)
    return t


panel = {
    'id': 1,
    'type': 'gapit-htmlgraphics-panel',
    'title': '',
    'transparent': True,
    'datasource': DS,
    'gridPos': {'h': 84, 'w': 24, 'x': 0, 'y': 0},
    'maxDataPoints': 400,
    'targets': [
        # A: itens numéricos (SSD / Slot / BBU)
        target('A', '0', ITEM_REGEX),
        # B: itens texto/char (ex.: SSD Slot X: Numero de serie / Estado)
        target('B', '2', ITEM_REGEX),
        # C: problemas ativos dos hosts (filtrados no painel por regex de storage)
        target('C', '5', '', showProblems='problems', options={
            'hostsInMaintenance': True,
            'hostProxy': False,
            'limit': 1001,
            'acknowledged': 2,
            'sortProblems': 'default',
            'minSeverity': 0,
            'severities': [0, 1, 2, 3, 4, 5],
            'useTimeRange': False,
            'showDisabledItems': False,
        }),
    ],
    'options': {
        'html': read('html.html'),
        'css': read('style.css'),
        'onRender': read('onRender.js'),
        'onInit': '',
        'codeData': read('codeData.json'),
        'rootCSS': '',
        'renderOnMount': True,
        'panelupdateOnMount': True,
        'dynamicHtmlGraphics': False,
        'dynamicData': False,
        'dynamicFieldDisplayValues': False,
        'dynamicProps': False,
        'centerAlignContent': False,
        'overflow': 'auto',
        'useGrafanaScrollbar': True,
        'SVGBaseFix': True,
        'add100Percentage': True,
        'calcsMutation': 'standard',
        'reduceOptions': {'calcs': ['last']},
    },
    'fieldConfig': {'defaults': {}, 'overrides': []},
}

dashboard = {
    '__inputs': [{
        'name': 'DS_ZABBIX', 'label': 'Zabbix', 'description': 'Datasource Zabbix (plugin Alexander Zobnin)',
        'type': 'datasource', 'pluginId': 'alexanderzobnin-zabbix-datasource', 'pluginName': 'Zabbix',
    }],
    '__requires': [
        {'type': 'grafana', 'id': 'grafana', 'name': 'Grafana', 'version': '10.0.0'},
        {'type': 'panel', 'id': 'gapit-htmlgraphics-panel', 'name': 'HTML graphics', 'version': '2.1.1'},
        {'type': 'datasource', 'id': 'alexanderzobnin-zabbix-datasource', 'name': 'Zabbix', 'version': '4.4.0'},
    ],
    'title': 'Storage Health — Infraestrutura',
    'description': 'Monitoramento de SSDs, RAID e baterias (MegaCLI / PERC) via Zabbix',
    'uid': 'storage-health-noc',
    'tags': ['NOC', 'Storage & Hardware', 'Dell PowerEdge', 'MegaCLI', 'Zabbix'],
    'editable': True,
    'graphTooltip': 0,
    'refresh': '1m',
    'schemaVersion': 39,
    'style': 'dark',
    'time': {'from': 'now-6h', 'to': 'now'},
    'timepicker': {'refresh_intervals': ['30s', '1m', '5m', '15m', '30m', '1h']},
    'timezone': 'browser',
    'templating': {'list': []},
    'annotations': {'list': []},
    'links': [],
    'panels': [panel],
    'version': 1,
}

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(dashboard, f, ensure_ascii=False, indent=2)
    f.write('\n')
print('gerado:', os.path.normpath(OUT))
