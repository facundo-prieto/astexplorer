import Element from './tree/Element';
import PropTypes from 'prop-types';
import React from 'react';
import {publish, subscribe} from '../../utils/pubsub.js';
import {treeAdapterFromParseResult} from '../../core/TreeAdapter.js';
import {SelectedNodeProvider} from './SelectedNodeContext.js';
import focusNodes from './focusNodes.js'
import {TREE_SNAPSHOT_EVENT} from './tree/snapshotEvent.js';

import './css/tree.css'

const {useReducer, useMemo, useRef, useLayoutEffect, useEffect} = React;

const STORAGE_KEY = 'tree_settings';

function initSettings() {
  const storedSettings = global.localStorage.getItem(STORAGE_KEY);
  return storedSettings ?
    JSON.parse(storedSettings) :
    {
      autofocus: true,
      hideFunctions: true,
      hideEmptyKeys: false,
      hideLocationData: false,
      hideTypeKeys: false,
    };
}

function reducer(state, element) {
  const newState = {...state, [element.name]: element.checked};

  global.localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
  return newState;
}

function makeCheckbox(name, settings, updateSettings) {
  return (
    <input
      type="checkbox"
      name={name}
      checked={settings[name]}
      onChange={event => updateSettings(event.target)}
    />
  );
}

export default function Tree({parseResult, position}) {
  const [settings, updateSettings] = useReducer(reducer, null, initSettings);
  const treeAdapter = useMemo(
    () => treeAdapterFromParseResult(parseResult, settings),
    [parseResult.treeAdapter, settings],
  );
  const rootElement = useRef();

  focusNodes('init');
  useLayoutEffect(() => {
    focusNodes('focus', rootElement);
  });

  useEffect(() => {
    const unsubscribe = subscribe(TREE_SNAPSHOT_EVENT, async () => {
      const markdown = buildMarkdownSnapshot(rootElement.current);
      if (markdown) {
        console.log('[Tree snapshot markdown]\n' + markdown); // eslint-disable-line no-console
      } else {
        console.log('[Tree snapshot markdown] <empty>'); // eslint-disable-line no-console
      }

      try {
        if (markdown && global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
          await global.navigator.clipboard.writeText(markdown);
          console.log('Tree snapshot copied to clipboard'); // eslint-disable-line no-console
        } else if (markdown) {
          console.log(markdown); // eslint-disable-line no-console
        }
      } catch (error) {
        console.error('Unable to copy tree snapshot', error); // eslint-disable-line no-console
      }
    });
    return unsubscribe;
  }, [rootElement]);

  return (
    <div className="tree-visualization container">
      <div className="toolbar">
        <label title="Auto open the node at the cursor in the source code">
          {makeCheckbox('autofocus', settings, updateSettings)}
          Autofocus
        </label>
        &#8203;
        {treeAdapter.getConfigurableFilters().map(filter => (
          <span key={filter.key}>
            <label>
              {makeCheckbox(filter.key, settings, updateSettings)}
              {filter.label}
            </label>
            &#8203;
          </span>
        ))}
      </div>
      <ul ref={rootElement} onMouseLeave={() => {publish('CLEAR_HIGHLIGHT');}}>
        <SelectedNodeProvider>
          <Element
            value={parseResult.ast}
            level={0}
            treeAdapter={treeAdapter}
            autofocus={settings.autofocus}
            position={position}
          />
        </SelectedNodeProvider>
      </ul>
    </div>
  );
}

Tree.propTypes = {
  parseResult: PropTypes.object,
  position: PropTypes.number,
};

function buildMarkdownSnapshot(listRoot) {
  const Scope = getGlobalScope();
  const HTMLElementRef = Scope && Scope.HTMLElement ? Scope.HTMLElement : null;
  if (!HTMLElementRef || !(listRoot instanceof HTMLElementRef)) {
    return '';
  }

  const entries = Array.from(listRoot.children).filter(isEntryElement);
  if (entries.length === 0) {
    return '';
  }

  const lines = entries.flatMap((entry, index) =>
    extractEntry(entry, 0, index < entries.length - 1),
  );

  if (lines.length === 0) {
    return '';
  }

  const body = lines.join('\n');
  return `\`\`\`\n${body}\n\`\`\``;
}

function isEntryElement(node) {
  const Scope = getGlobalScope();
  const HTMLElementRef = Scope && Scope.HTMLElement ? Scope.HTMLElement : null;
  return HTMLElementRef && node instanceof HTMLElementRef && node.classList.contains('entry');
}

function extractEntry(entryElement, depth, hasTrailingComma) {
  const indent = '  '.repeat(depth);
  const keyText = getOwnText(entryElement, ':scope > span.key');
  const valueText = getOwnText(entryElement, ':scope > span.value');
  const prefixText = getOwnText(entryElement, ':scope > span.prefix');
  const suffixText = getOwnText(entryElement, ':scope > .suffix');
  const lines = [];

  let line = '';
  if (keyText) {
    line = keyText;
  }
  if (valueText) {
    line = line ? `${line} ${valueText}` : valueText;
  }
  if (prefixText) {
    line = line ? `${line} ${prefixText}` : prefixText;
  }
  if (line) {
    lines.push(indent + line);
  }

  if (prefixText) {
    const list = entryElement.querySelector(':scope > ul.value-body');
    if (list) {
      const childEntries = Array.from(list.children).filter(isEntryElement);
      childEntries.forEach((child, index) => {
        const childLines = extractEntry(
          child,
          depth + 1,
          index < childEntries.length - 1,
        );
        lines.push(...childLines);
      });
    }
  }

  if (suffixText) {
    lines.push(indent + suffixText);
  }

  if (hasTrailingComma && lines.length > 0) {
    const lastIndex = lines.length - 1;
    lines[lastIndex] = `${lines[lastIndex]},`;
  }

  return lines;
}

function getOwnText(element, selector) {
  const node = element.querySelector(selector);
  if (!node) {
    return '';
  }
  return node.textContent
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getGlobalScope() {
  if (typeof globalThis !== 'undefined') {
    return globalThis;
  }
  if (typeof window !== 'undefined') {
    return window;
  }
  if (typeof global !== 'undefined') {
    return global;
  }
  return undefined;
}
