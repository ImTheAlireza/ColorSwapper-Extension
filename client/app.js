var cs = new CSInterface();
var scannedColors = [];
var colorSwaps = {};
var undoHistory = [];
var MAX_UNDO_HISTORY = 10;
var isAutoRescan = false;
var scanDebounce = null; // ← ADD THIS


var cepFS = new CSInterface().getSystemPath ? window.cep.fs : null;

var CURRENT_VERSION = '1.0.0'; // Fallback
var VERSION_CHECK_URL = 'https://raw.githubusercontent.com/ImTheAlireza/ColorSwapper-Extension/main/version.json';

// Load version from manifest.xml
(function loadVersionFromManifest() {
  try {
    var extPath = cs.getSystemPath(SystemPath.EXTENSION);
    var manifestPath = extPath + '/CSXS/manifest.xml';
    manifestPath = manifestPath.replace(/\\/g, '/');
    
    if (manifestPath.indexOf('file:///') === 0) {
      manifestPath = manifestPath.replace('file:///', '');
    } else if (manifestPath.indexOf('file://') === 0) {
      manifestPath = manifestPath.replace('file://', '');
    }
    
    if (cepFS) {
      var result = cepFS.readFile(manifestPath, cepFS.UTF8);
      if (result.err === 0 && result.data) {
        // Parse XML to extract version
        var versionMatch = result.data.match(/ExtensionBundleVersion="([^"]+)"/);
        if (versionMatch && versionMatch[1]) {
          CURRENT_VERSION = versionMatch[1];
          log('Version from manifest: ' + CURRENT_VERSION);
        }
      }
    }
  } catch (e) {
    log('Could not read manifest version: ' + e.message);
  }
})();


document.getElementById('authorLink').addEventListener('click', function (e) {
    e.preventDefault();
    var url = this.getAttribute('href');
    if (url) {
        if (typeof cep !== 'undefined' && cep.util) {
            cep.util.openURLInDefaultBrowser(url);
        } else {
            window.open(url, '_blank');
        }
    }
});


function getCleanExtPath() {
    var raw = cs.getSystemPath(SystemPath.EXTENSION);
    var clean = raw.replace(/\\/g, '/');
    

    if (clean.indexOf('file:///') === 0) {
        clean = clean.replace('file:///', '');
    } else if (clean.indexOf('file://') === 0) {
        clean = clean.replace('file://', '');
    }
    

    if (clean.charAt(clean.length - 1) === '/') {
        clean = clean.substring(0, clean.length - 1);
    }
    
    log('Raw ext path: ' + raw);
    log('Clean ext path: ' + clean);
    return clean;
}

function isNewerVersion(remote, local) {
    var r = remote.split('.');
    var l = local.split('.');
    for (var i = 0; i < Math.max(r.length, l.length); i++) {
        var rv = parseInt(r[i]) || 0;
        var lv = parseInt(l[i]) || 0;
        if (rv > lv) return true;
        if (rv < lv) return false;
    }
    return false;
}

function fetchJSON(url, callback) {
    try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url + '?t=' + Date.now(), true); // cache-bust
        xhr.timeout = 8000;
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try {
                        callback(null, JSON.parse(xhr.responseText));
                    } catch (e) {
                        callback(e);
                    }
                } else {
                    callback(new Error('HTTP ' + xhr.status));
                }
            }
        };
        xhr.onerror = function () { callback(new Error('Network error')); };
        xhr.ontimeout = function () { callback(new Error('Timeout')); };
        xhr.send();
    } catch (e) {
        callback(e);
    }
}

function fetchText(url, callback) {
    try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url + '?t=' + Date.now(), true);
        xhr.timeout = 15000;
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    callback(null, xhr.responseText);
                } else {
                    callback(new Error('HTTP ' + xhr.status));
                }
            }
        };
        xhr.onerror = function () { callback(new Error('Network error')); };
        xhr.ontimeout = function () { callback(new Error('Timeout')); };
        xhr.send();
    } catch (e) {
        callback(e);
    }
}

function checkForUpdates() {
    if (!VERSION_CHECK_URL || VERSION_CHECK_URL.indexOf('YOUR_USERNAME') !== -1) {
        log('Update check skipped — URL not configured');
        return;
    }

    log('Checking for updates...');

    fetchJSON(VERSION_CHECK_URL, function (err, data) {
        if (err) {
            log('Update check failed: ' + err.message);
            return;
        }

        if (!data || !data.version) {
            log('Invalid version data');
            return;
        }

        log('Remote version: ' + data.version + ' | Local: ' + CURRENT_VERSION);

        if (isNewerVersion(data.version, CURRENT_VERSION)) {
            showUpdateBanner(data);
        } else {
            log('Extension is up to date');
        }
    });
}

var pendingUpdateData = null;

function showUpdateBanner(data) {
    pendingUpdateData = data;

    document.getElementById('updateVersion').textContent = data.version;
    document.getElementById('updateChangelog').textContent = data.changelog || '';
    document.getElementById('updateBanner').classList.remove('hidden');
}

function performUpdate() {
  if (!pendingUpdateData) return;
  if (!cepFS) {
    showToast('Filesystem not available');
    return;
  }
  
  var data = pendingUpdateData;
  var files = data.files;
  var baseUrl = data.baseUrl;
  
  if (!files || files.length === 0 || !baseUrl) {
    showToast('Invalid update data');
    return;
  }
  
  // SECURITY: Validate all files before downloading
  var validFiles = [];
  for (var i = 0; i < files.length; i++) {
    if (validateUpdateFile(files[i])) {
      validFiles.push(files[i]);
    }
  }
  
  if (validFiles.length === 0) {
    showToast('No valid files to update');
    return;
  }
  
  // Continue with validFiles instead of files
  var extPath = getCleanExtPath();
  var btn = document.getElementById('updateBtn');
  btn.disabled = true;
  btn.textContent = 'Downloading...';
  
  log('Updating ' + validFiles.length + ' file(s) from ' + baseUrl);
  log('Extension path: ' + extPath);
  
  var downloaded = [];
  var completed = 0;
  var total = validFiles.length;
  var errors = [];
  
  for (var i = 0; i < validFiles.length; i++) {
    (function (fileEntry) {
      var remotePath, localPath;
      if (typeof fileEntry === 'string') {
        remotePath = fileEntry;
        localPath = fileEntry;
      } else {
        remotePath = fileEntry.remote;
        localPath = fileEntry.local;
      }
      
      var url = baseUrl + remotePath;
      log('Downloading: ' + remotePath);
      
      fetchText(url, function (err, content) {
        completed++;
        if (err) {
          errors.push(remotePath + ': ' + err.message);
          log('Download failed: ' + remotePath + ' — ' + err.message);
        } else if (!content || content.length === 0) {
          // SECURITY: Reject empty downloads
          errors.push(remotePath + ': empty file');
          log('Download rejected: ' + remotePath + ' (empty)');
        } else {
          downloaded.push({
            localPath: localPath,
            content: content
          });
          log('Downloaded: ' + remotePath + ' (' + content.length + ' bytes)');
        }
        
        btn.textContent = 'Downloading ' + completed + '/' + total;
        
        if (completed === total) {
          if (errors.length > 0) {
            btn.textContent = 'Update Failed';
            setTimeout(function () { 
              btn.textContent = 'Retry'; 
              btn.disabled = false; 
            }, 2000);
            setStatus('Download failed: ' + errors.join(', '), 'error');
            log('Update aborted — download errors');
          } else {
            writeUpdateFiles(downloaded, extPath, btn);
          }
        }
      });
    })(validFiles[i]);
  }
}

function writeUpdateFiles(downloaded, extPath, btn) {
  btn.textContent = 'Installing...';
  
  var writeErrors = [];
  var tempFiles = [];
  
  // Phase 1: Write to temp files
  for (var i = 0; i < downloaded.length; i++) {
    var entry = downloaded[i];
    try {
      var filePath = extPath + '/' + entry.localPath;
      filePath = filePath.replace(/\\/g, '/').replace(/\/\//g, '/');
      
      var dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
      ensureDirCEP(dirPath);
      
      // Write to .tmp file first
      var tempPath = filePath + '.tmp';
      log('Writing temp: ' + tempPath);
      
      var result = cepFS.writeFile(tempPath, entry.content);
      
      if (result.err !== 0) {
        writeErrors.push(entry.localPath + ': write error ' + result.err);
        log('Temp write failed: ' + entry.localPath);
      } else {
        // Validate file was written
        var readResult = cepFS.readFile(tempPath);
        if (readResult.err !== 0 || readResult.data.length === 0) {
          writeErrors.push(entry.localPath + ': validation failed');
          log('Temp validation failed: ' + entry.localPath);
        } else {
          tempFiles.push({
            temp: tempPath,
            final: filePath,
            localPath: entry.localPath
          });
          log('Temp validated: ' + tempPath + ' (' + readResult.data.length + ' bytes)');
        }
      }
    } catch (e) {
      writeErrors.push(entry.localPath + ': ' + e.message);
      log('Temp write exception: ' + e.message);
    }
  }
  
  // If any temp writes failed, abort
  if (writeErrors.length > 0) {
    // Clean up temp files
    for (var t = 0; t < tempFiles.length; t++) {
      try {
        cepFS.deleteFile(tempFiles[t].temp);
      } catch (e) {}
    }
    
    btn.textContent = 'Install Failed';
    setStatus('Write errors: ' + writeErrors.join(', '), 'error');
    setTimeout(function () { 
      btn.textContent = 'Retry'; 
      btn.disabled = false; 
    }, 3000);
    return;
  }
  
  // Phase 2: Replace original files
  btn.textContent = 'Replacing files...';
  var replaceErrors = [];
  
  for (var j = 0; j < tempFiles.length; j++) {
    var tf = tempFiles[j];
    try {
      // Delete original if exists
      var stat = cepFS.stat(tf.final);
      if (stat.err === 0) {
        var delResult = cepFS.deleteFile(tf.final);
        if (delResult.err !== 0) {
          replaceErrors.push(tf.localPath + ': cannot delete original');
          continue;
        }
      }
      
      // Rename temp to final
      // CEP doesn't have rename, so read+write+delete
      var tempData = cepFS.readFile(tf.temp);
      if (tempData.err === 0) {
        var finalResult = cepFS.writeFile(tf.final, tempData.data);
        if (finalResult.err === 0) {
          cepFS.deleteFile(tf.temp);
          log('Replaced: ' + tf.final);
        } else {
          replaceErrors.push(tf.localPath + ': final write failed');
        }
      }
    } catch (e) {
      replaceErrors.push(tf.localPath + ': ' + e.message);
    }
  }
  
  if (replaceErrors.length > 0) {
    btn.textContent = 'Partial Update';
    setStatus('Some files failed: ' + replaceErrors.join(', '), 'error');
    setTimeout(function () { 
      btn.textContent = 'Retry Failed'; 
      btn.disabled = false; 
    }, 3000);
  } else {
    btn.textContent = 'Updated!';
    setStatus('Update installed! Reloading...', 'success');
    log('Update complete — reloading in 1.5s');
    setTimeout(function () {
      location.reload();
    }, 1500);
  }
}


function validateUpdateFile(fileEntry) {
  var remotePath, localPath;
  
  if (typeof fileEntry === 'string') {
    remotePath = fileEntry;
    localPath = fileEntry;
  } else {
    remotePath = fileEntry.remote;
    localPath = fileEntry.local;
  }
  
  // Whitelist of allowed files
  var allowedFiles = [
    'client/app.js',
    'client/style.css',
    'client/index.html',
    'client/CSInterface.js',
    'host/hostScript.jsx',
    'CSXS/manifest.xml',
    'version.json'
  ];
  
  // Check if file is in whitelist
  if (allowedFiles.indexOf(localPath) === -1) {
    log('SECURITY: Blocked non-whitelisted file: ' + localPath);
    return false;
  }
  
  // Reject path traversal attempts
  if (localPath.indexOf('..') !== -1 || 
      localPath.indexOf('\\') !== -1 ||
      localPath.charAt(0) === '/' ||
      localPath.indexOf(':') !== -1) {
    log('SECURITY: Blocked suspicious path: ' + localPath);
    return false;
  }
  
  return true;
}


function ensureDirCEP(dirPath) {
    var readResult = cepFS.readdir(dirPath);
    if (readResult.err !== 0) {
        // Directory doesn't exist — create parent first
        var parentDir = dirPath.substring(0, dirPath.lastIndexOf('/'));
        if (parentDir && parentDir !== dirPath) {
            ensureDirCEP(parentDir);
        }
        cepFS.makedir(dirPath);
    }
}

document.getElementById('updateBtn').addEventListener('click', function () {
    performUpdate();
});

document.getElementById('dismissUpdate').addEventListener('click', function () {
    document.getElementById('updateBanner').classList.add('hidden');
    pendingUpdateData = null;
});

document.getElementById('reloadBtn').addEventListener('click', function () {
    location.reload();
});

document.getElementById('aboutBtn').addEventListener('click', function () {
    document.getElementById('currentVersionLabel').textContent = CURRENT_VERSION;
    document.getElementById('aboutModal').classList.remove('hidden');
});

document.getElementById('closeAbout').addEventListener('click', function () {
    document.getElementById('aboutModal').classList.add('hidden');
});

document.getElementById('aboutModal').addEventListener('click', function (e) {
    if (e.target === this) {
        this.classList.add('hidden');
    }
});

document.getElementById('aboutGithubLink').addEventListener('click', function () {
    var url = this.getAttribute('data-url');
    if (url) {
        // Open in default browser
        if (typeof cep !== 'undefined' && cep.util) {
            cep.util.openURLInDefaultBrowser(url);
        } else {
            window.open(url, '_blank');
        }
    }
});

setTimeout(function () {
    checkForUpdates();
}, 3000);

function callJSX(funcName, argsObj, callback) {
    var jsonStr = JSON.stringify(argsObj);
    var escaped = jsonStr
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');

    var script = funcName + "('" + escaped + "')";
    cs.evalScript(script, callback);
}

function log(msg) {
    var el = document.getElementById('debug');
    el.textContent += msg + '\n';
    el.scrollTop = el.scrollHeight;
}

document.getElementById('showLogs').addEventListener('change', function () {
    var el = document.getElementById('debug');
    if (this.checked) {
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
});

(function () {
    try {
        var extPath = cs.getSystemPath(SystemPath.EXTENSION);
        var jsxPath = extPath + '/host/hostScript.jsx';
        jsxPath = jsxPath.replace(/\\/g, '/');
        if (jsxPath.indexOf('file:///') === 0) {
            jsxPath = jsxPath.replace('file:///', '');
        } else if (jsxPath.indexOf('file://') === 0) {
            jsxPath = jsxPath.replace('file://', '');
        }
        log('Loading JSX: ' + jsxPath);
        cs.evalScript('$.evalFile("' + jsxPath + '")', function (result) {
            log('JSX loaded OK');
        });
    } catch (e) {
        log('JSX load error: ' + e.message);
    }
})();

function debouncedScan() {
    if (scanDebounce) {
        log('Scan already in progress');
        showToast('Scan in progress...');
        return;
    }
    var btn = document.getElementById('scanBtn');
    btn.classList.add('scanning');
    btn.querySelector('.btn-text').textContent = 'Scanning...';
    btn.disabled = true;
    setStatus('Scanning composition...', 'info');
    scanDebounce = true;
    var includePrecomps = document.getElementById('includePrecomps').checked;
    var threshold = document.getElementById('matchSimilar').checked ? parseInt(document.getElementById('similarThreshold').value) || 10 : 0;
    var selectedOnly = document.getElementById('selectedOnly').checked;
    try {
        cs.evalScript('scanColors(' + includePrecomps + ',' + threshold + ',' + selectedOnly + ')', function (result) {
            scanDebounce = null;
            btn.classList.remove('scanning');
            btn.querySelector('.btn-text').textContent = 'Scan Colors';
            btn.disabled = false;
            log('Scan: found ' + (result ? result.length : 0) + ' chars');
            if (result === 'EvalScript_ErrMessage' || !result || result === 'undefined' || result === 'null') {
                if (selectedOnly) {
                    setStatus('Select layers in timeline first', 'error');
                } else {
                    setStatus('No active composition found', 'error');
                }
                return;
            }
            try {
                scannedColors = JSON.parse(result);
                if (scannedColors.length === 0) {
                    if (selectedOnly) {
                        setStatus('No colors found in selected layers', 'error');
                    } else {
                        setStatus('No colors found in this comp', 'error');
                    }
                    return;
                }
                if (!isAutoRescan) clearUndoHistory(); else isAutoRescan = false;
                document.getElementById('emptyState').classList.add('hidden');
                renderColorList();
                updateSummary();
                document.getElementById('summary').classList.remove('hidden');
                document.getElementById('paletteBar').classList.remove('hidden');
                document.getElementById('swapWrap').classList.remove('hidden');
                var staticCount = 0, kfCount = 0;
                for (var i = 0; i < scannedColors.length; i++) {
                    if (scannedColors[i].type === 'keyframeGroup') kfCount++; else staticCount++;
                }
                var msg = 'Found ' + staticCount + ' color' + (staticCount !== 1 ? 's' : '');
                if (kfCount > 0) msg += ' + ' + kfCount + ' keyframed';
                setStatus(msg, 'success');
            } catch (e) { setStatus('Error parsing results', 'error'); log('Parse error: ' + e.message); }
        });
    } catch (e) {
        scanDebounce = null;
        btn.classList.remove('scanning');
        btn.querySelector('.btn-text').textContent = 'Scan Colors';
        btn.disabled = false;
        setStatus('Script error: ' + e.message, 'error');
    }
}

document.getElementById('scanBtn').addEventListener('click', debouncedScan);

document.getElementById('swapBtn').addEventListener('click', function () {
    var allSwaps = getChangedSwaps();

    var staticSwaps = [];
    var keyframeSwaps = [];

    for (var i = 0; i < allSwaps.length; i++) {
        if (allSwaps[i].type === 'keyframe') {
            keyframeSwaps.push(allSwaps[i]);
        } else {
            for (var j = 0; j < scannedColors.length; j++) {
                var sc = scannedColors[j];
                if (sc.type !== 'keyframeGroup' && sc.hex === allSwaps[i].oldColor) {
                    allSwaps[i].mergedFrom = sc.mergedFrom || [sc.hex];
                    break;
                }
            }
            staticSwaps.push(allSwaps[i]);
        }
    }

    if (staticSwaps.length === 0 && keyframeSwaps.length === 0) {
        setStatus('Pick new colors first', 'error');
        return;
    }

    var includePrecomps = document.getElementById('includePrecomps').checked;
    var selectedOnly = document.getElementById('selectedOnly').checked;

    var totalSwapCount = staticSwaps.length + keyframeSwaps.length;
    setStatus('Swapping...', 'info');
    log('Swapping ' + totalSwapCount + ' color group(s)');

    callJSX('swapColors', {
        swaps: staticSwaps,
        keyframeSwaps: keyframeSwaps,
        includePrecomps: includePrecomps,
        selectedOnly: selectedOnly
    }, function (result) {
        log('Swap result: ' + result);

        if (result === 'EvalScript_ErrMessage') {
            setStatus('Error during swap', 'error');
            return;
        }

        try {
            var res = JSON.parse(result);

            if (res.changes && res.changes.length > 0) {
                addToUndoHistory({
                    staticSwaps: staticSwaps,
                    keyframeSwaps: keyframeSwaps,
                    changes: res.changes,
                    includePrecomps: includePrecomps,
                    selectedOnly: selectedOnly,
                    timestamp: Date.now()
                });
                updateUndoButton();
            }

            setStatus('Swapped ' + res.count + ' instance' + (res.count !== 1 ? 's' : ''), 'success');

            isAutoRescan = true;
            setTimeout(function () {
                document.getElementById('scanBtn').click();
            }, 500);
        } catch (e) {
            setStatus('Swap complete', 'success');

            isAutoRescan = true;
            setTimeout(function () {
                document.getElementById('scanBtn').click();
            }, 500);
        }
    });
});

document.getElementById('resetAllBtn').addEventListener('click', function () {
    if (scannedColors.length === 0) return;

    for (var i = 0; i < scannedColors.length; i++) {
        var item = scannedColors[i];
        if (item.type === 'keyframeGroup') {
            resetKeyframeCard(i);
        } else {
            resetSingleColor(i);
        }
    }

    updateSwapCount();
    setStatus('All colors reset', '');
});

function resetSingleColor(index) {
    var item = scannedColors[index];
    if (!item || item.type === 'keyframeGroup') return;
    var hex = item.hex;
    colorSwaps[hex] = hex;

    var swatch = document.getElementById('newSwatch_' + index);
    if (swatch) swatch.style.backgroundColor = hex;


    // FIX: Also reset the text hex input field
    var hexInput = document.getElementById('hexInput_' + index);
    if (hexInput) hexInput.value = hex;

    var card = document.getElementById('colorCard_' + index);
    if (card) card.classList.remove('changed');

    var hexEl = document.getElementById('hexDisplay_' + index);
    if (hexEl) {
        hexEl.innerHTML = '';
        hexEl.textContent = hex;
        hexEl.setAttribute('data-hex', hex);
    }

    updateSwapCount();
}

function resetKeyframeCard(index) {
    var item = scannedColors[index];
    if (!item || item.type !== 'keyframeGroup') return;

    for (var c = 0; c < item.colors.length; c++) {
        var cellId = index + '_' + c;
        var swapKey = 'kf:' + index + ':' + c;
        var origHex = item.colors[c].hex;

        colorSwaps[swapKey] = origHex;

        var swatch = document.getElementById('newSwatch_' + cellId);
        if (swatch) swatch.style.backgroundColor = origHex;


        var cell = document.getElementById('chainCell_' + cellId);
        if (cell) cell.classList.remove('changed');

        var hexEl = document.getElementById('hexDisplay_' + cellId);
        if (hexEl) {
            hexEl.innerHTML = '';
            hexEl.textContent = origHex;
            hexEl.setAttribute('data-hex', origHex);
        }
    }

    var card = document.getElementById('colorCard_' + index);
    if (card) card.classList.remove('changed');
}

function renderColorList() {
    var container = document.getElementById('colorList');
    container.innerHTML = '';
    colorSwaps = {};

    for (var i = 0; i < scannedColors.length; i++) {
        var item = scannedColors[i];

        if (item.type === 'keyframeGroup') {
            buildKeyframeCard(i);
        } else {
            buildColorCard(i);
        }
    }

    updateSwapCount();
}

function buildKeyframeCard(index) {
    var item = scannedColors[index];
    var colors = item.colors;

    var card = document.createElement('div');
    card.className = 'color-card keyframe-chain';
    card.id = 'colorCard_' + index;
    card.style.animationDelay = (index * 0.04) + 's';

    // Action buttons (same as static cards)
    var actionsHTML =
        '<div class="card-actions" id="cardActions_' + index + '">' +
        '   <button class="btn-select" id="selectBtn_' + index + '" title="Select layers with this color">◎ Select</button>' +
        '   <span class="action-divider"></span>' +
        '   <button class="btn-reset" id="resetBtn_' + index + '" title="Reset this color">↺ Reset</button>' +
        '</div>';

    // Header
    var typeLabel = formatType(item.propertyType);
    var headerHTML =
        '<div class="chain-header">' +
        '   <span class="chain-icon">◆</span>' +
        '   <span class="chain-title">' + escapeHTML(item.layerName) + ' · ' + typeLabel + '</span>' +
        '   <span class="chain-meta">' + item.totalKeys + ' keys</span>' +
        '</div>';

    // Key cells
    var cellsHTML = '<div class="chain-cells">';

    for (var c = 0; c < colors.length; c++) {
        var kColor = colors[c];
        var cellId = index + '_' + c;

        var swapKey = 'kf:' + index + ':' + c;
        colorSwaps[swapKey] = kColor.hex;

        var timeLabel = formatKeyTimes(kColor.times);

        cellsHTML +=
            '<div class="chain-cell" id="chainCell_' + cellId + '">' +
            '   <div class="cell-swatches">' +
            '       <div class="color-swatch" style="background-color:' + kColor.hex + '"></div>' +
            '       <span class="color-arrow">→</span>' +
			'       <div class="new-color-swatch" id="newSwatch_' + cellId + '" style="background-color:' + kColor.hex + '"></div>' +
            '   </div>' +
            '   <div class="cell-info">' +
            '       <div class="color-hex clickable-hex" id="hexDisplay_' + cellId + '" data-hex="' + kColor.hex + '">' + kColor.hex + '</div>' +
            '       <div class="cell-keys">' + timeLabel + '</div>' +
            '   </div>' +
            '</div>';
    }

    cellsHTML += '</div>';

    card.innerHTML = actionsHTML + headerHTML + cellsHTML;
    document.getElementById('colorList').appendChild(card);

    // Bind cell inputs
    for (var b = 0; b < colors.length; b++) {
        bindKeyframeInput(index, b, colors[b].hex);
        bindHexCopyByID(index + '_' + b);
    }

    // Bind action buttons
    bindResetButton(index);
    bindSelectButton(index);
}

function formatKeyTimes(times) {
    var labels = [];
    for (var t = 0; t < times.length; t++) {
        labels.push(formatTime(times[t]));
    }
    return 'K' + (times.length > 1 ? ' ×' + times.length : '') + ' @ ' + labels.join(', ');
}

function formatTime(seconds) {
    var mins = Math.floor(seconds / 60);
    var secs = Math.round((seconds % 60) * 100) / 100;
    var secsStr = secs < 10 ? '0' + secs : '' + secs;
    return mins + ':' + secsStr;
}

function escapeHTML(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}


function bindKeyframeInput(cardIndex, cellIndex, originalHex) {
    var cellId = cardIndex + '_' + cellIndex;
    var swapKey = 'kf:' + cardIndex + ':' + cellIndex;
    var swatch = document.getElementById('newSwatch_' + cellId);
    
    if (!swatch) return;
    
    swatch.style.cursor = 'pointer';
    swatch.addEventListener('click', function (e) {
        e.stopPropagation();
        var currentHex = colorSwaps[swapKey] || originalHex;
        
        openCustomColorPicker(currentHex, function(newHex) {
            if (!newHex) return;
            
            // ✅ CORRECT: Use swapKey for keyframes
            colorSwaps[swapKey] = newHex;
            
            swatch.style.backgroundColor = newHex;
            
            var cell = document.getElementById('chainCell_' + cellId);
            var hexEl = document.getElementById('hexDisplay_' + cellId);
            
            if (newHex.toLowerCase() !== originalHex.toLowerCase()) {
                if (cell) cell.classList.add('changed');
                if (hexEl) {
                    hexEl.innerHTML =
                        '<span class="old-hex">' + originalHex + '</span> ' +
                        '<span class="new-hex">' + newHex + '</span>';
                    hexEl.setAttribute('data-hex', newHex);
                }
            } else {
                if (cell) cell.classList.remove('changed');
                if (hexEl) {
                    hexEl.innerHTML = '';
                    hexEl.textContent = originalHex;
                    hexEl.setAttribute('data-hex', originalHex);
                }
            }
            
            // Update parent card changed state
            var card = document.getElementById('colorCard_' + cardIndex);
            if (card) {
                var anyCellChanged = card.querySelector('.chain-cell.changed');
                if (anyCellChanged) card.classList.add('changed');
                else card.classList.remove('changed');
            }
            
            updateSwapCount();
        });
    });
}

function bindHexCopyByID(cellId) {
    var hexEl = document.getElementById('hexDisplay_' + cellId);
    if (!hexEl) return;

    hexEl.addEventListener('click', function (e) {
        e.stopPropagation();
        var hexValue = this.getAttribute('data-hex');
        if (!hexValue) return;
        var ok = copyToClipboard(hexValue);
        showToast(ok ? 'Copied ' + hexValue : 'Copy failed');
    });
}

function buildColorCard(index) {
    var item = scannedColors[index];
    var hex = item.hex;
    var mergedFrom = item.mergedFrom || [hex];
    var exprCount = item.expressionCount || 0;
    colorSwaps[hex] = hex;

    var types = [];
    for (var t = 0; t < item.locations.length; t++) {
        var locType = item.locations[t].type;
        if (types.indexOf(locType) === -1) types.push(locType);
    }
    var typeLabels = [];
    for (var j = 0; j < types.length; j++) {
        typeLabels.push(formatType(types[j]));
    }
    var typeStr = typeLabels.join(', ');

    // Expression badge
    var badgeHTML = '';
    if (exprCount > 0) {
        if (exprCount >= item.count) {
            badgeHTML = '<span class="expr-badge expr-all" title="All instances are expression-driven — swap will be skipped">ƒ all</span>';
        } else {
            badgeHTML = '<span class="expr-badge" title="' + exprCount + ' of ' + item.count + ' expression-driven — those will be skipped">ƒ ' + exprCount + '</span>';
        }
    }

    var swatchRowHTML = '';
    for (var s = 0; s < mergedFrom.length; s++) {
        swatchRowHTML += '<div class="color-swatch" style="background-color:' + mergedFrom[s] + '" title="' + mergedFrom[s] + '"></div>';
    }

    swatchRowHTML += '<span class="color-arrow">→</span>';
	swatchRowHTML += '<div class="new-color-swatch" id="newSwatch_' + index + '" style="background-color:' + hex + '" title="Click to pick color"></div>';
	
    var mergedHexHTML = '';
    if (mergedFrom.length > 1) {
        var hexParts = [];
        for (var m = 0; m < mergedFrom.length; m++) {
            hexParts.push(mergedFrom[m]);
        }
        mergedHexHTML = '<div class="merged-label">' + hexParts.join(' + ') + '</div>';
    }

	var card = document.createElement('div');
	card.className = 'color-card' + (exprCount >= item.count ? ' expr-only' : '');
	card.id = 'colorCard_' + index;
	card.style.animationDelay = (index * 0.04) + 's';

	card.innerHTML =
	  '<div class="card-actions" id="cardActions_' + index + '">' +
	  '  <button class="btn-select" id="selectBtn_' + index + '" title="Select layers">Select</button>' +
	  '  <span class="action-divider"></span>' +
	  '  <button class="btn-reset" id="resetBtn_' + index + '" title="Reset">Reset</button>' +
	  '</div>' +
	  '<div class="swatch-row">' + swatchRowHTML + '</div>' +
	  mergedHexHTML +
	  '<div class="color-info">' +
	  '  <input type="text" class="hex-input" id="hexInput_' + index + '" value="' + hex + '" maxlength="7" placeholder="#000000">' +
	  '  <div class="color-hex clickable-hex" id="hexDisplay_' + index + '" data-hex="' + hex + '" title="Click to copy">' + hex + '</div>' +
	  '  <div class="color-count">' + item.count + ' inst · <span class="color-type">' + typeStr + '</span> ' + badgeHTML + '</div>' +
	  '</div>';

    document.getElementById('colorList').appendChild(card);

    bindColorInput(index, hex);
    bindResetButton(index);
    bindHexCopy(index);
    bindSelectButton(index);
}

function bindColorInput(index, originalHex) {
    var swatch = document.getElementById('newSwatch_' + index);
    if (!swatch) return;
    
    swatch.style.cursor = 'pointer';
    swatch.addEventListener('click', function (e) {
        e.stopPropagation();
        var currentHex = colorSwaps[originalHex] || originalHex;
        
        openCustomColorPicker(currentHex, function(newHex) {
            if (!newHex) return;
            
            // ✅ CORRECT: Use originalHex as key for static colors
            colorSwaps[originalHex] = newHex;
            
            swatch.style.backgroundColor = newHex;
            
            var hexInput = document.getElementById('hexInput_' + index);
            if (hexInput) hexInput.value = newHex;
            
            var card = document.getElementById('colorCard_' + index);
            var hexEl = document.getElementById('hexDisplay_' + index);
            
            if (newHex.toLowerCase() !== originalHex.toLowerCase()) {
                if (card) card.classList.add('changed');
                if (hexEl) {
                    hexEl.innerHTML =
                        '<span class="old-hex">' + originalHex + '</span> ' +
                        '<span class="new-hex">' + newHex + '</span>';
                    hexEl.setAttribute('data-hex', newHex);
                }
            } else {
                if (card) card.classList.remove('changed');
                if (hexEl) {
                    hexEl.innerHTML = '';
                    hexEl.textContent = originalHex;
                    hexEl.setAttribute('data-hex', originalHex);
                }
            }
            
            updateSwapCount();
        });
    });
}


function bindResetButton(index) {
    var btn = document.getElementById('resetBtn_' + index);
    if (!btn) return;

    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var item = scannedColors[index];
        if (item.type === 'keyframeGroup') {
            resetKeyframeCard(index);
        } else {
            resetSingleColor(index);
        }
        updateSwapCount();
    });
}

function copyToClipboard(text) {
    // CEP panels block navigator.clipboard and execCommand — use cep.util if available
    try {
        if (typeof cep !== 'undefined' && cep.util && cep.util.setClipboardData) {
            cep.util.setClipboardData('plain/text', text);
            return true;
        }
    } catch (e) {}

    // Fallback: create a hidden input, focus it, and execCommand
    try {
        var el = document.createElement('input');
        el.setAttribute('type', 'text');
        el.setAttribute('value', text);
        el.style.position = 'fixed';
        el.style.top = '0';
        el.style.left = '0';
        el.style.opacity = '0';
        el.style.fontSize = '12pt'; // prevent iOS zoom
        document.body.appendChild(el);
        el.focus();
        el.select();
        el.setSelectionRange(0, 99999);
        document.execCommand('copy');
        document.body.removeChild(el);
        return true;
    } catch (e) {}

    return false;
}

function bindHexCopy(index) {
    var hexEl = document.getElementById('hexDisplay_' + index);
    if (!hexEl) return;

    hexEl.addEventListener('click', function (e) {
        e.stopPropagation();
        var hexValue = this.getAttribute('data-hex');
        if (!hexValue) return;
        var ok = copyToClipboard(hexValue);
        showToast(ok ? 'Copied ' + hexValue : 'Copy failed');
    });
}

function bindSelectButton(index) {
    var btn = document.getElementById('selectBtn_' + index);
    if (!btn) return;

    btn.addEventListener('click', function (e) {
        e.stopPropagation();

        var item = scannedColors[index];
        var colors;

        if (item.type === 'keyframeGroup') {
            colors = [];
            for (var c = 0; c < item.colors.length; c++) {
                if (colors.indexOf(item.colors[c].hex) === -1) {
                    colors.push(item.colors[c].hex);
                }
            }
        } else {
            colors = item.mergedFrom || [item.hex];
        }

        var includePrecomps = document.getElementById('includePrecomps').checked;

        callJSX('selectLayersByColor', {
            colors: colors,
            includePrecomps: includePrecomps
        }, function (result) {
            log('Select result: ' + result);

            if (result === 'EvalScript_ErrMessage' || !result) {
                showToast('Error selecting layers');
                return;
            }

            try {
                var res = JSON.parse(result);
                if (res.count === 0) {
                    showToast('No layers found');
                    setStatus('No layers with this color', '');
                } else {
                    showToast('Selected ' + res.count + ' layer' + (res.count !== 1 ? 's' : ''));
                    setStatus('Selected: ' + res.layers.join(', '), 'success');
                }
            } catch (err) {
                showToast('Layers selected');
            }
        });
    });
}

function showToast(msg) {
    var old = document.getElementById('toast');
    if (old) old.remove();

    var toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);

    setTimeout(function () {
        toast.classList.add('show');
    }, 10);

    setTimeout(function () {
        toast.classList.remove('show');
        setTimeout(function () {
            if (toast.parentNode) toast.remove();
        }, 300);
    }, 1500);
}

function getChangedSwaps() {
    var swaps = [];
    for (var key in colorSwaps) {
        var newHex = colorSwaps[key];

        if (key.indexOf('kf:') === 0) {
            var parts = key.split(':');
            var cardIndex = parseInt(parts[1]);
            var cellIndex = parseInt(parts[2]);
            var item = scannedColors[cardIndex];

            if (item && item.type === 'keyframeGroup') {
                var origHex = item.colors[cellIndex].hex;
                if (newHex.toLowerCase() !== origHex.toLowerCase()) {
                    swaps.push({
                        type: 'keyframe',
                        cardIndex: cardIndex,
                        cellIndex: cellIndex,
                        oldColor: origHex,
                        newColor: newHex,
                        keyIndices: item.colors[cellIndex].keyIndices,
                        layerIndex: item.layerIndex,
                        compID: item.compID,
                        propertyType: item.propertyType,
                        propertyPath: item.propertyPath
                    });
                }
            }
        } else {
            if (newHex && newHex.toLowerCase() !== key.toLowerCase()) {
                swaps.push({
                    type: 'static',
                    oldColor: key,
                    newColor: newHex
                });
            }
        }
    }
    return swaps;
}

function updateSwapCount() {
    var count = getChangedSwaps().length;
    document.getElementById('swapCount').textContent = count + ' color' + (count !== 1 ? 's' : '') + ' to swap';
    document.getElementById('swapBtn').disabled = (count === 0);
}

function updateSummary() {
    var staticCount = 0;
    var staticInstances = 0;
    var kfCount = 0;

    for (var i = 0; i < scannedColors.length; i++) {
        var item = scannedColors[i];
        if (item.type === 'keyframeGroup') {
            kfCount++;
        } else {
            staticCount++;
            staticInstances += item.count;
        }
    }

    var text = staticCount + ' color' + (staticCount !== 1 ? 's' : '') + ' · ' + staticInstances + ' instances';
    if (kfCount > 0) {
        text += ' · ' + kfCount + ' keyframed';
    }
    document.getElementById('summaryText').textContent = text;
}

function formatType(type) {
    var map = {
        'solid': 'Solid',
        'shapeFill': 'Fill',
        'shapeStroke': 'Stroke',
        'textFill': 'Text',
        'textStroke': 'Text Stroke'
    };
    if (map[type]) return map[type];
    if (type.indexOf('effect:') === 0) return type.replace('effect:', '');
    return type;
}

function setStatus(msg, type) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = 'status' + (type ? ' ' + type : '');
}

var paletteDropdownOpen = false;
var saveInputOpen = false;

document.getElementById('savePaletteBtn').addEventListener('click', function () {
    if (scannedColors.length === 0) {
        showToast('Scan colors first');
        return;
    }

    closePaletteDropdown();

    var saveInput = document.getElementById('saveInput');
    if (saveInputOpen) {
        saveInput.classList.add('hidden');
        saveInputOpen = false;
    } else {
        saveInput.classList.remove('hidden');
        saveInputOpen = true;
        document.getElementById('paletteName').value = '';
        document.getElementById('paletteName').focus();
    }
});

document.getElementById('saveConfirmBtn').addEventListener('click', function () {
    savePalette();
});

document.getElementById('paletteName').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.keyCode === 13) {
        savePalette();
    }
    if (e.key === 'Escape' || e.keyCode === 27) {
        closeSaveInput();
    }
});

document.getElementById('saveCancelBtn').addEventListener('click', function () {
    closeSaveInput();
});

document.getElementById('loadPaletteBtn').addEventListener('click', function () {
    if (scannedColors.length === 0) {
        showToast('Scan colors first');
        return;
    }

    closeSaveInput();

    if (paletteDropdownOpen) {
        closePaletteDropdown();
    } else {
        renderPaletteList();
        document.getElementById('paletteDropdown').classList.remove('hidden');
        paletteDropdownOpen = true;
    }
});

document.addEventListener('click', function (e) {
    var dropdown = document.getElementById('paletteDropdown');
    var loadBtn = document.getElementById('loadPaletteBtn');

    if (paletteDropdownOpen &&
        !dropdown.contains(e.target) &&
        e.target !== loadBtn) {
        closePaletteDropdown();
    }
});

function savePalette() {
    var nameInput = document.getElementById('paletteName');
    var name = nameInput.value.trim();

    if (!name) {
        showToast('Enter a palette name');
        nameInput.focus();
        return;
    }

    if (scannedColors.length === 0) {
        showToast('Scan colors first');
        return;
    }

    var colors = [];
    for (var i = 0; i < scannedColors.length; i++) {
        var item = scannedColors[i];
        if (item.type === 'keyframeGroup') {
            // Save each keyframe color
            for (var c = 0; c < item.colors.length; c++) {
                var swapKey = 'kf:' + i + ':' + c;
                colors.push(colorSwaps[swapKey] || item.colors[c].hex);
            }
        } else {
            var picked = colorSwaps[item.hex] || item.hex;
            colors.push(picked);
        }
    }

    var palette = {
        name: name,
        created: getDateString(),
        colors: colors
    };

    var palettes = getAllPalettes();
    palettes.push(palette);
    localStorage.setItem('colorswapper_palettes', JSON.stringify(palettes));

    closeSaveInput();
    showToast('Palette "' + name + '" saved!');
    setStatus('Saved palette with ' + colors.length + ' colors', 'success');
}

function loadPalette(index) {
    var palettes = getAllPalettes();
    if (index < 0 || index >= palettes.length) return;

    var palette = palettes[index];
    var paletteColors = (palette && palette.colors) ? palette.colors : [];

    if (scannedColors.length === 0) {
        showToast('Scan colors first');
        return;
    }

    // Small helper (kept inside the function so you can copy-paste safely)
    function normalizeHex(h) {
        if (!h) return null;
        h = ('' + h).trim();
        if (h.charAt(0) !== '#') h = '#' + h;
        if (!/^#[0-9A-Fa-f]{6}$/.test(h)) return null;
        return h.toLowerCase();
    }

    var mapped = 0;
    var paletteIdx = 0;

    for (var i = 0; i < scannedColors.length; i++) {
        var item = scannedColors[i];

        // ----------------------------
        // Keyframed color groups
        // ----------------------------
        if (item.type === 'keyframeGroup') {
            for (var c = 0; c < item.colors.length; c++) {
                if (paletteIdx >= paletteColors.length) break;

                var cellId = i + '_' + c;
                var swapKey = 'kf:' + i + ':' + c;

                var origHex = item.colors[c].hex;
                var newHexRaw = paletteColors[paletteIdx];
                paletteIdx++;

                var newHex = normalizeHex(newHexRaw);
                if (!newHex) continue; // skip invalid palette entry

                colorSwaps[swapKey] = newHex;

                var swatch = document.getElementById('newSwatch_' + cellId);
                if (swatch) swatch.style.backgroundColor = newHex;


                var cell = document.getElementById('chainCell_' + cellId);
                var hexEl = document.getElementById('hexDisplay_' + cellId);

                if (newHex.toLowerCase() !== (origHex || '').toLowerCase()) {
                    if (cell) cell.classList.add('changed');
                    if (hexEl) {
                        hexEl.innerHTML =
                            '<span class="old-hex">' + origHex + '</span> <span class="new-hex">' + newHex + '</span>';
                        hexEl.setAttribute('data-hex', newHex);
                    }
                    mapped++;
                } else {
                    if (cell) cell.classList.remove('changed');
                    if (hexEl) {
                        hexEl.innerHTML = '';
                        hexEl.textContent = origHex;
                        hexEl.setAttribute('data-hex', origHex);
                    }
                }
            }

            // Update parent card changed state
            var card = document.getElementById('colorCard_' + i);
            if (card) {
                var anyCellChanged = card.querySelector('.chain-cell.changed');
                if (anyCellChanged) card.classList.add('changed');
                else card.classList.remove('changed');
            }

            continue;
        }

        // ----------------------------
        // Static colors
        // ----------------------------
        if (paletteIdx >= paletteColors.length) break;

        var originalHex = item.hex;
        var newHex2Raw = paletteColors[paletteIdx];
        paletteIdx++;

        var newHex2 = normalizeHex(newHex2Raw);
        if (!newHex2) continue; // skip invalid palette entry

        colorSwaps[originalHex] = newHex2;

        var swatch2 = document.getElementById('newSwatch_' + i);
        if (swatch2) swatch2.style.backgroundColor = newHex2;


        // ✅ FIX 3: Sync the hex text field (your new <input type="text" class="hex-input">)
        var hexInput2 = document.getElementById('hexInput_' + i);
        if (hexInput2) hexInput2.value = newHex2;

        var card2 = document.getElementById('colorCard_' + i);
        var hexEl2 = document.getElementById('hexDisplay_' + i);

        if (newHex2.toLowerCase() !== (originalHex || '').toLowerCase()) {
            if (card2) card2.classList.add('changed');
            if (hexEl2) {
                hexEl2.innerHTML =
                    '<span class="old-hex">' + originalHex + '</span> <span class="new-hex">' + newHex2 + '</span>';
                hexEl2.setAttribute('data-hex', newHex2);
            }
            mapped++;
        } else {
            if (card2) card2.classList.remove('changed');
            if (hexEl2) {
                hexEl2.innerHTML = '';
                hexEl2.textContent = originalHex;
                hexEl2.setAttribute('data-hex', originalHex);
            }
        }
    }

    updateSwapCount();
    closePaletteDropdown();
    showToast('Loaded "' + palette.name + '"');
    setStatus('Mapped ' + mapped + ' colors from "' + palette.name + '"', 'success');
}

function deletePalette(index) {
    var palettes = getAllPalettes();
    if (index < 0 || index >= palettes.length) return;

    var name = palettes[index].name;
    palettes.splice(index, 1);
    localStorage.setItem('colorswapper_palettes', JSON.stringify(palettes));

    renderPaletteList();
    showToast('Deleted "' + name + '"');
}

function renderPaletteList() {
    var container = document.getElementById('paletteList');
    var palettes = getAllPalettes();

    if (palettes.length === 0) {
        container.innerHTML = '<div class="palette-empty">No palettes saved yet</div>';
        return;
    }

    container.innerHTML = '';

    for (var i = 0; i < palettes.length; i++) {
        buildPaletteEntry(container, palettes[i], i);
    }
}

function buildPaletteEntry(container, palette, index) {
    var entry = document.createElement('div');
    entry.className = 'palette-entry';

    var dotsHTML = '';
    var showCount = Math.min(palette.colors.length, 8);
    for (var c = 0; c < showCount; c++) {
        dotsHTML += '<div class="palette-dot" style="background-color:' + palette.colors[c] + '"></div>';
    }
    if (palette.colors.length > 8) {
        dotsHTML += '<span style="color:#555;font-size:10px">+' + (palette.colors.length - 8) + '</span>';
    }

    entry.innerHTML =
        '<div class="palette-colors">' + dotsHTML + '</div>' +
        '<div class="palette-info">' +
        '   <div class="palette-name">' + palette.name + '</div>' +
        '   <div class="palette-date">' + palette.created + ' · <span class="palette-color-count">' + palette.colors.length + ' colors</span></div>' +
        '</div>' +
        '<button class="btn-palette-delete" id="palDel_' + index + '" title="Delete">Delete</button>';

    container.appendChild(entry);

    entry.addEventListener('click', function (e) {
        if (e.target.classList.contains('btn-palette-delete') || e.target.id.indexOf('palDel_') === 0) {
            return;
        }
        loadPalette(index);
    });

    var delBtn = document.getElementById('palDel_' + index);
    if (delBtn) {
        delBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            deletePalette(index);
        });
    }
}

function getAllPalettes() {
    try {
        var data = localStorage.getItem('colorswapper_palettes');
        if (data) {
            return JSON.parse(data);
        }
    } catch (e) {}
    return [];
}

function getDateString() {
    var d = new Date();
    var month = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' +
        (month < 10 ? '0' : '') + month + '-' +
        (day < 10 ? '0' : '') + day;
}

function closeSaveInput() {
    document.getElementById('saveInput').classList.add('hidden');
    saveInputOpen = false;
}

function closePaletteDropdown() {
    document.getElementById('paletteDropdown').classList.add('hidden');
    paletteDropdownOpen = false;
}

function addToUndoHistory(entry) {
    undoHistory.push(entry);

    if (undoHistory.length > MAX_UNDO_HISTORY) {
        undoHistory.shift();
    }

    log('Undo history: ' + undoHistory.length + ' operation(s) stored');
}

function updateUndoButton() {
    var btn = document.getElementById('undoBtn');
    if (!btn) return;

    if (undoHistory.length > 0) {
        btn.classList.remove('hidden');
        btn.disabled = false;
    } else {
        btn.classList.add('hidden');
        btn.disabled = true;
    }
}

function clearUndoHistory() {
    undoHistory = [];
    updateUndoButton();
    log('Undo history cleared');
}

document.getElementById('undoBtn').addEventListener('click', function () {
    if (undoHistory.length === 0) {
        setStatus('Nothing to undo', 'error');
        return;
    }

    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Undoing...';

    var lastOperation = undoHistory[undoHistory.length - 1];

    callJSX('undoSwap', lastOperation, function (result) {
        btn.innerHTML = '<span class="btn-icon"><svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 6.5a5 5 0 1 1 1 3.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><polyline points="2.5,3.5 2.5,6.5 5.5,6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span> Undo';

        if (result === 'EvalScript_ErrMessage') {
            setStatus('Error during undo', 'error');
            btn.disabled = false;
            return;
        }

        try {
            var res = JSON.parse(result);

            if (res.success) {
                undoHistory.pop();
                updateUndoButton();

                var msg = 'Undone';
                if (res.restored > 0) {
                    msg += ' (' + res.restored + ' instance' + (res.restored !== 1 ? 's' : '') + ' restored';
                    if (res.skipped > 0) {
                        msg += ', ' + res.skipped + ' skipped';
                    }
                    msg += ')';
                }

                setStatus(msg, 'success');

                isAutoRescan = true;
                setTimeout(function () {
                    document.getElementById('scanBtn').click();
                }, 500);
            } else {
                setStatus('Undo failed: ' + (res.message || 'Unknown error'), 'error');
                btn.disabled = false;
            }
        } catch (e) {
            setStatus('Error processing undo result', 'error');
            log('Undo parse error: ' + e.message);
            btn.disabled = false;
        }
    });
});


function openCustomColorPicker(initialHex, callback) {

    var overlay = document.getElementById('colorPickerOverlay');
    overlay.classList.remove('hidden');

    overlay.innerHTML = `
        <div class="picker">
            ${document.querySelector('.picker')?.innerHTML || ''}
        </div>
    `;

    var picker = overlay.querySelector('.picker');
    var closeBtn = picker.querySelector('.picker-title span');
    var okBtn = picker.querySelector('.btn-ok');
    var cancelBtn = picker.querySelector('.btn-cancel');

    function close() {
        overlay.classList.add('hidden');
        overlay.innerHTML = '';
    }

    closeBtn.onclick = close;
    cancelBtn.onclick = close;

    // Initialize picker state
    var hue = 0, sat = 1, bri = 1;

    function hexToHsv(hex) {
        hex = hex.replace('#','');
        var r = parseInt(hex.substring(0,2),16);
        var g = parseInt(hex.substring(2,4),16);
        var b = parseInt(hex.substring(4,6),16);
        return rgb2hsv(r,g,b);
    }

    function rgb2hsv(r,g,b){
        r/=255;g/=255;b/=255;
        var max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,h,s=max===0?0:d/max,v=max;
        if(d===0)h=0;
        else if(max===r)h=60*((g-b)/d%6);
        else if(max===g)h=60*((b-r)/d+2);
        else h=60*((r-g)/d+4);
        if(h<0)h+=360;
        return {h:h,s:s,v:v};
    }

    var hsv = hexToHsv(initialHex || "#ffffff");
    hue = hsv.h;
    sat = hsv.s;
    bri = hsv.v;

    // You can re-use your existing picker script logic here
    // For now we just set hex field
    var hexInput = picker.querySelector('#fHex');
    hexInput.value = initialHex.replace('#','');

    okBtn.onclick = function(){
        var val = hexInput.value.trim();
        if (!/^([0-9A-Fa-f]{6})$/.test(val)) {
            showToast("Invalid hex");
            return;
        }
        close();
        callback("#" + val.toUpperCase());
    };
}