function scanColors(includePrecomps, threshold, selectedOnly) {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return null;

    var colorMap = {};
    var keyframeGroups = [];

    scanComp(comp, colorMap, keyframeGroups, includePrecomps, selectedOnly);

    if (threshold && threshold > 0) {
        colorMap = mergeSimilarColors(colorMap, threshold);
    }

    var result = [];

    for (var hex in colorMap) {
        result.push({
            type: 'static',
            hex: hex,
            count: colorMap[hex].count,
            locations: colorMap[hex].locations,
            mergedFrom: colorMap[hex].mergedFrom || [hex],
            expressionCount: colorMap[hex].expressionCount || 0
        });
    }

    result.sort(function (a, b) { return b.count - a.count; });

    for (var g = 0; g < keyframeGroups.length; g++) {
        result.push(keyframeGroups[g]);
    }

    return JSON.stringify(result);
}

function scanComp(comp, colorMap, keyframeGroups, includePrecomps, selectedOnly) {
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);

        if (selectedOnly && !layer.selected) continue;

        scanLayer(layer, colorMap, keyframeGroups, comp);

        if (includePrecomps && layer.source instanceof CompItem) {
            scanComp(layer.source, colorMap, keyframeGroups, true, false);
        }
    }
}

function scanLayer(layer, colorMap, keyframeGroups, comp) {
    // 1. Solid layers
    if (layer instanceof AVLayer && layer.source instanceof SolidSource) {
        var solidColor = layer.source.mainSource.color;
        addColor(colorMap, rgbToHex(solidColor), layer.name, 'solid', false);
    }

    // 2. Text layers
    if (layer instanceof TextLayer) {
        try {
            var textProp = layer.property("ADBE Text Properties").property("ADBE Text Document");
            var textExpr = false;
            try { textExpr = textProp.expressionEnabled; } catch (ex) {}

            var textDoc = textProp.value;

            if (textDoc.fillColor) {
                addColor(colorMap, rgbToHex(textDoc.fillColor), layer.name, 'textFill', textExpr);
            }
            if (textDoc.strokeColor) {
                addColor(colorMap, rgbToHex(textDoc.strokeColor), layer.name, 'textStroke', textExpr);
            }
        } catch (e) {}
    }

    // 3. Shape layers
    if (layer instanceof ShapeLayer) {
        var contents = layer.property("ADBE Root Vectors Group");
        if (contents) {
            scanShapeTree(contents, colorMap, keyframeGroups, layer.name, layer, comp);
        }
    }

    // 4. Effects
    var effects = layer.property("ADBE Effect Parade");
    if (effects) {
        for (var e = 1; e <= effects.numProperties; e++) {
            var effect = effects.property(e);
            scanEffectForColors(effect, colorMap, keyframeGroups, layer.name, layer, comp);
        }
    }
}

function scanShapeTree(group, colorMap, keyframeGroups, layerName, layer, comp) {
    for (var i = 1; i <= group.numProperties; i++) {
        var prop = group.property(i);

        if (prop.matchName === "ADBE Vector Graphic - Fill") {
            try {
                var fillProp = prop.property("ADBE Vector Fill Color");
                var fillExpr = false;
                try { fillExpr = fillProp.expressionEnabled; } catch (ex) {}

                if (fillProp.numKeys > 0) {
                    addKeyframedColor(keyframeGroups, fillProp, layerName, 'shapeFill', layer, comp);
                } else {
                    addColor(colorMap, rgbToHex(fillProp.value), layerName, 'shapeFill', fillExpr);
                }
            } catch (e) {}
        }

        if (prop.matchName === "ADBE Vector Graphic - Stroke") {
            try {
                var strokeProp = prop.property("ADBE Vector Stroke Color");
                var strokeExpr = false;
                try { strokeExpr = strokeProp.expressionEnabled; } catch (ex) {}

                if (strokeProp.numKeys > 0) {
                    addKeyframedColor(keyframeGroups, strokeProp, layerName, 'shapeStroke', layer, comp);
                } else {
                    addColor(colorMap, rgbToHex(strokeProp.value), layerName, 'shapeStroke', strokeExpr);
                }
            } catch (e) {}
        }

        if (prop.numProperties && prop.numProperties > 0) {
            scanShapeTree(prop, colorMap, keyframeGroups, layerName, layer, comp);
        }
    }
}

function scanEffectForColors(effect, colorMap, keyframeGroups, layerName, layer, comp) {
    for (var p = 1; p <= effect.numProperties; p++) {
        try {
            var prop = effect.property(p);
            if (prop.propertyValueType === PropertyValueType.COLOR) {
                var propExpr = false;
                try { propExpr = prop.expressionEnabled; } catch (ex) {}

                if (prop.numKeys > 0) {
                    addKeyframedColor(keyframeGroups, prop, layerName, 'effect:' + effect.name, layer, comp);
                } else {
                    addColor(colorMap, rgbToHex(prop.value), layerName, 'effect:' + effect.name, propExpr);
                }
            }
            if (prop.numProperties && prop.numProperties > 0) {
                scanEffectForColors(prop, colorMap, keyframeGroups, layerName, layer, comp);
            }
        } catch (e) {}
    }
}

function addKeyframedColor(keyframeGroups, prop, layerName, type, layer, comp) {
    var uniqueColors = {};

    for (var k = 1; k <= prop.numKeys; k++) {
        var hex = rgbToHex(prop.keyValue(k));
        var timeVal = prop.keyTime(k);
        var timeSec = Math.round(timeVal * 100) / 100;

        if (!uniqueColors[hex]) {
            uniqueColors[hex] = {
                keyIndices: [],
                times: []
            };
        }
        uniqueColors[hex].keyIndices.push(k);
        uniqueColors[hex].times.push(timeSec);
    }

    var colors = [];
    for (var h in uniqueColors) {
        colors.push({
            hex: h,
            keyIndices: uniqueColors[h].keyIndices,
            times: uniqueColors[h].times
        });
    }

    keyframeGroups.push({
        type: 'keyframeGroup',
        layerName: layerName,
        layerIndex: layer.index,
        compID: comp.id,
        compName: comp.name,
        propertyType: type,
        propertyPath: buildPropertyPath(prop),
        totalKeys: prop.numKeys,
        colors: colors
    });
}

function buildPropertyPath(prop) {
    var parts = [];
    var current = prop;

    while (current) {
        try {
            if (current.name && current.name !== '') {
                parts.unshift(current.name);
            }
            current = current.parentProperty;
        } catch (e) {
            break;
        }
    }

    if (parts.length > 2) {
        parts = parts.slice(1, parts.length - 1);
    }

    return parts.join(' > ');
}

function mergeSimilarColors(colorMap, thresholdPercent) {
    var hexes = [];
    for (var h in colorMap) {
        hexes.push(h);
    }

    hexes.sort(function (a, b) {
        return colorMap[b].count - colorMap[a].count;
    });

    var merged = {};
    var used = {};

    for (var i = 0; i < hexes.length; i++) {
        if (used[hexes[i]]) continue;

        var primary = hexes[i];
        merged[primary] = {
            count: colorMap[primary].count,
            locations: colorMap[primary].locations.slice(0),
            mergedFrom: [primary],
            expressionCount: colorMap[primary].expressionCount || 0
        };
        used[primary] = true;

        for (var j = i + 1; j < hexes.length; j++) {
            if (used[hexes[j]]) continue;

            if (colorsAreSimilar(primary, hexes[j], thresholdPercent)) {
                merged[primary].count += colorMap[hexes[j]].count;
                merged[primary].mergedFrom.push(hexes[j]);
                merged[primary].expressionCount += (colorMap[hexes[j]].expressionCount || 0);
                for (var k = 0; k < colorMap[hexes[j]].locations.length; k++) {
                    merged[primary].locations.push(colorMap[hexes[j]].locations[k]);
                }
                used[hexes[j]] = true;
            }
        }
    }

    return merged;
}

function swapColors(argsJSON) {
    var args = JSON.parse(argsJSON);
    var swaps = args.swaps || [];
    var keyframeSwaps = args.keyframeSwaps || [];
    var includePrecomps = args.includePrecomps;
    var selectedOnly = args.selectedOnly || false;

    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        return JSON.stringify({ count: 0, changes: [] });
    }

    app.beginUndoGroup("Color Swap");

    var changeLog = [];
    var totalCount = 0;

    if (swaps.length > 0) {
        totalCount += swapInComp(comp, swaps, includePrecomps, selectedOnly, changeLog, comp.id, comp.name);
    }

    for (var k = 0; k < keyframeSwaps.length; k++) {
        totalCount += swapKeyframeColor(keyframeSwaps[k], changeLog);
    }

    app.endUndoGroup();

    return JSON.stringify({
        count: totalCount,
        changes: changeLog
    });
}

function swapInComp(comp, swaps, includePrecomps, selectedOnly, changeLog, compID, compName) {
    var count = 0;

    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);

        if (selectedOnly && !layer.selected) continue;

        count += swapInLayer(layer, swaps, changeLog, compID, compName);

        if (includePrecomps && layer.source instanceof CompItem) {
            count += swapInComp(layer.source, swaps, true, false, changeLog, layer.source.id, layer.source.name);
        }
    }

    return count;
}

function swapInLayer(layer, swaps, changeLog, compID, compName) {
    return withUnlockedLayer(layer, function () {
        var count = 0;

        // 1. Solid layers
        if (layer instanceof AVLayer && layer.source instanceof SolidSource) {
            var solidColor = rgbToHex(layer.source.mainSource.color);
            var newColor = findExactSwap(solidColor, swaps);
            if (newColor) {
                logChange(changeLog, layer, compID, compName, 'solid', solidColor, newColor);
                layer.source.mainSource.color = hexToRgb(newColor);
                count++;
            }
        }

        // 2. Text layers
        if (layer instanceof TextLayer) {
            try {
                var textProp = layer.property("ADBE Text Properties").property("ADBE Text Document");

                // Skip if expression-driven
                var textExpr = false;
                try { textExpr = textProp.expressionEnabled; } catch (ex) {}

                if (!textExpr) {
                    var textDoc = textProp.value;
                    var changed = false;

                    if (textDoc.fillColor) {
                        var fillHex = rgbToHex(textDoc.fillColor);
                        var newFill = findExactSwap(fillHex, swaps);
                        if (newFill) {
                            logChange(changeLog, layer, compID, compName, 'textFill', fillHex, newFill);
                            textDoc.fillColor = hexToRgb(newFill);
                            changed = true;
                            count++;
                        }
                    }

                    if (textDoc.strokeColor) {
                        var strokeHex = rgbToHex(textDoc.strokeColor);
                        var newStroke = findExactSwap(strokeHex, swaps);
                        if (newStroke) {
                            logChange(changeLog, layer, compID, compName, 'textStroke', strokeHex, newStroke);
                            textDoc.strokeColor = hexToRgb(newStroke);
                            changed = true;
                            count++;
                        }
                    }

                    if (changed) {
                        textProp.setValue(textDoc);
                    }
                }
            } catch (e) {}
        }

        // 3. Shape layers
        if (layer instanceof ShapeLayer) {
            var contents = layer.property("ADBE Root Vectors Group");
            if (contents) {
                count += swapShapeTree(contents, swaps, changeLog, layer, compID, compName);
            }
        }

        // 4. Effects
        var effects = layer.property("ADBE Effect Parade");
        if (effects) {
            for (var e = 1; e <= effects.numProperties; e++) {
                var effect = effects.property(e);
                count += swapEffectColors(effect, swaps, changeLog, layer, compID, compName);
            }
        }

        return count;
    });
}

function swapShapeTree(group, swaps, changeLog, layer, compID, compName) {
    var count = 0;

    for (var i = 1; i <= group.numProperties; i++) {
        var prop = group.property(i);

        if (prop.matchName === "ADBE Vector Graphic - Fill") {
            try {
                var fillProp = prop.property("ADBE Vector Fill Color");
                if (fillProp.numKeys === 0) {
                    var fillExpr = false;
                    try { fillExpr = fillProp.expressionEnabled; } catch (ex) {}

                    if (!fillExpr) {
                        var fillHex = rgbToHex(fillProp.value);
                        var newColor = findExactSwap(fillHex, swaps);
                        if (newColor) {
                            logChange(changeLog, layer, compID, compName, 'shapeFill', fillHex, newColor, fillProp.matchName);
                            var newRGB = hexToRgb(newColor);
                            newRGB[3] = fillProp.value[3]; // preserve alpha
                            fillProp.setValue(newRGB);
                            count++;
                        }
                    }
                }
            } catch (e) {}
        }

        if (prop.matchName === "ADBE Vector Graphic - Stroke") {
            try {
                var strokeProp = prop.property("ADBE Vector Stroke Color");
                if (strokeProp.numKeys === 0) {
                    var strokeExpr = false;
                    try { strokeExpr = strokeProp.expressionEnabled; } catch (ex) {}

                    if (!strokeExpr) {
                        var strokeHex = rgbToHex(strokeProp.value);
                        var newColor2 = findExactSwap(strokeHex, swaps);
                        if (newColor2) {
                            logChange(changeLog, layer, compID, compName, 'shapeStroke', strokeHex, newColor2, strokeProp.matchName);
                            var newRGB2 = hexToRgb(newColor2);
                            newRGB2[3] = strokeProp.value[3]; // preserve alpha
                            strokeProp.setValue(newRGB2);
                            count++;
                        }
                    }
                }
            } catch (e) {}
        }

        if (prop.numProperties && prop.numProperties > 0) {
            count += swapShapeTree(prop, swaps, changeLog, layer, compID, compName);
        }
    }

    return count;
}

function swapEffectColors(effect, swaps, changeLog, layer, compID, compName) {
    var count = 0;

    for (var p = 1; p <= effect.numProperties; p++) {
        try {
            var prop = effect.property(p);
            if (prop.propertyValueType === PropertyValueType.COLOR) {
                if (prop.numKeys === 0) {
                    var propExpr = false;
                    try { propExpr = prop.expressionEnabled; } catch (ex) {}

                    if (!propExpr) {
                        var hex = rgbToHex(prop.value);
                        var newColor = findExactSwap(hex, swaps);
                        if (newColor) {
                            logChange(changeLog, layer, compID, compName, 'effect:' + effect.name, hex, newColor, prop.matchName);
                            var newRGB = hexToRgb(newColor);
                            newRGB[3] = prop.value[3]; // preserve alpha
                            prop.setValue(newRGB);
                            count++;
                        }
                    }
                }
            }
            if (prop.numProperties && prop.numProperties > 0) {
                count += swapEffectColors(prop, swaps, changeLog, layer, compID, compName);
            }
        } catch (e) {}
    }

    return count;
}


function swapKeyframeColor(kfSwap, changeLog) {
    var comp = findCompByID(kfSwap.compID);
    if (!comp) return 0;

    var layer = null;
    try {
        layer = comp.layer(kfSwap.layerIndex);
    } catch (e) {
        return 0;
    }
    if (!layer) return 0;

    return withUnlockedLayer(layer, function () {
        var prop = findColorProperty(layer, kfSwap.propertyType, kfSwap.oldColor, true);
        if (!prop) return 0;

        var count = 0;
        var keyIndices = kfSwap.keyIndices;

        for (var k = 0; k < keyIndices.length; k++) {
            var ki = keyIndices[k];
            try {
                var currentHex = rgbToHex(prop.keyValue(ki));
                if (currentHex.toLowerCase() === kfSwap.oldColor.toLowerCase()) {
                    var newRGB = hexToRgb(kfSwap.newColor);
                    var currentAlpha = prop.keyValue(ki)[3];
                    newRGB[3] = (currentAlpha !== undefined) ? currentAlpha : 1;

                    prop.setValueAtKey(ki, newRGB);

                    changeLog.push({
                        type: 'keyframe',
                        layerID: layer.index,
                        layerName: layer.name,
                        compID: kfSwap.compID,
                        compName: comp.name,
                        propertyType: kfSwap.propertyType,
                        oldColor: kfSwap.oldColor,
                        newColor: kfSwap.newColor,
                        keyIndex: ki,
                        wasLocked: layer.locked
                    });

                    count++;
                }
            } catch (e) {}
        }

        return count;
    });
}

function findColorProperty(layer, propertyType, hexToMatch, isKeyframed) {
    try {
        if (propertyType === 'shapeFill') {
            return findShapeColorProp(
                layer.property("ADBE Root Vectors Group"),
                "ADBE Vector Graphic - Fill",
                "ADBE Vector Fill Color",
                hexToMatch,
                isKeyframed
            );
        }

        if (propertyType === 'shapeStroke') {
            return findShapeColorProp(
                layer.property("ADBE Root Vectors Group"),
                "ADBE Vector Graphic - Stroke",
                "ADBE Vector Stroke Color",
                hexToMatch,
                isKeyframed
            );
        }

        if (propertyType === 'textFill' || propertyType === 'textStroke') {
            return layer.property("ADBE Text Properties").property("ADBE Text Document");
        }

        if (propertyType.indexOf('effect:') === 0) {
            var effectName = propertyType.replace('effect:', '');
            var effects = layer.property("ADBE Effect Parade");
            if (effects) {
                return findEffectColorProp(effects, effectName, hexToMatch, isKeyframed);
            }
        }
    } catch (e) {}

    return null;
}

function findShapeColorProp(group, parentMatch, colorMatch, hexToMatch, isKeyframed) {
    if (!group) return null;

    for (var i = 1; i <= group.numProperties; i++) {
        var prop = group.property(i);

        if (prop.matchName === parentMatch) {
            try {
                var colorProp = prop.property(colorMatch);
                if (isKeyframed && colorProp.numKeys > 0) {
                    // Check ALL keyframe values, not just first
                    for (var k = 1; k <= colorProp.numKeys; k++) {
                        var keyHex = rgbToHex(colorProp.keyValue(k));
                        if (keyHex.toLowerCase() === hexToMatch.toLowerCase()) {
                            return colorProp;
                        }
                    }
                } else if (!isKeyframed && colorProp.numKeys === 0) {
                    return colorProp;
                }
            } catch (e) {}
        }

        if (prop.numProperties && prop.numProperties > 0) {
            var found = findShapeColorProp(prop, parentMatch, colorMatch, hexToMatch, isKeyframed);
            if (found) return found;
        }
    }

    return null;
}

function findEffectColorProp(effects, effectName, hexToMatch, isKeyframed) {
    for (var e = 1; e <= effects.numProperties; e++) {
        var effect = effects.property(e);
        if (effect.name === effectName) {
            for (var p = 1; p <= effect.numProperties; p++) {
                try {
                    var prop = effect.property(p);
                    if (prop.propertyValueType === PropertyValueType.COLOR) {
                        if (isKeyframed && prop.numKeys > 0) {
                            // Check ALL keyframe values
                            for (var k = 1; k <= prop.numKeys; k++) {
                                var keyHex = rgbToHex(prop.keyValue(k));
                                if (keyHex.toLowerCase() === hexToMatch.toLowerCase()) {
                                    return prop;
                                }
                            }
                        } else if (!isKeyframed && prop.numKeys === 0) {
                            return prop;
                        }
                    }
                } catch (e2) {}
            }
        }
    }
    return null;
}

function logChange(changeLog, layer, compID, compName, propertyType, oldColor, newColor, propertyMatchName) {
    changeLog.push({
        layerID: layer.index,
        layerName: layer.name,
        compID: compID,
        compName: compName,
        propertyType: propertyType,
        propertyMatchName: propertyMatchName || '',
        oldColor: oldColor,
        newColor: newColor,
        wasLocked: layer.locked
    });
}

function undoSwap(historyJSON) {
    try {
        var history = JSON.parse(historyJSON);
        var changes = history.changes;

        if (!changes || changes.length === 0) {
            return JSON.stringify({
                success: false,
                message: 'No changes to undo',
                restored: 0,
                skipped: 0
            });
        }

        app.beginUndoGroup("Undo Color Swap");

        var restored = 0;
        var skipped = 0;

        var compGroups = {};
        for (var i = 0; i < changes.length; i++) {
            var change = changes[i];
            if (!compGroups[change.compID]) {
                compGroups[change.compID] = [];
            }
            compGroups[change.compID].push(change);
        }

        for (var compID in compGroups) {
            var comp = findCompByID(parseInt(compID));
            if (!comp) {
                skipped += compGroups[compID].length;
                continue;
            }

            var compChanges = compGroups[compID];
            for (var j = 0; j < compChanges.length; j++) {
                var change = compChanges[j];

                if (change.type === 'keyframe') {
                    var success = restoreKeyframeColor(change);
                    if (success) {
                        restored++;
                    } else {
                        skipped++;
                    }
                } else {
                    var layer = null;
                    try {
                        layer = comp.layer(change.layerID);
                    } catch (e) {
                        skipped++;
                        continue;
                    }

                    if (!layer || layer.name !== change.layerName) {
                        skipped++;
                        continue;
                    }

                    var success2 = restoreColorToLayer(layer, change);
                    if (success2) {
                        restored++;
                    } else {
                        skipped++;
                    }
                }
            }
        }

        app.endUndoGroup();

        return JSON.stringify({
            success: true,
            restored: restored,
            skipped: skipped
        });

    } catch (e) {
        return JSON.stringify({
            success: false,
            message: 'Undo error: ' + e.toString(),
            restored: 0,
            skipped: 0
        });
    }
}

function restoreColorToLayer(layer, change) {
    try {
        return withUnlockedLayer(layer, function () {
            var propertyType = change.propertyType;
            var oldColor = hexToRgb(change.oldColor);

            if (propertyType === 'solid') {
                if (layer instanceof AVLayer && layer.source instanceof SolidSource) {
                    layer.source.mainSource.color = oldColor;
                    return true;
                }
            }

            if (propertyType === 'textFill' || propertyType === 'textStroke') {
                if (layer instanceof TextLayer) {
                    var textProp = layer.property("ADBE Text Properties").property("ADBE Text Document");
                    var textDoc = textProp.value;

                    if (propertyType === 'textFill') {
                        textDoc.fillColor = oldColor;
                    } else {
                        textDoc.strokeColor = oldColor;
                    }

                    textProp.setValue(textDoc);
                    return true;
                }
            }

            if (propertyType === 'shapeFill' || propertyType === 'shapeStroke') {
                if (layer instanceof ShapeLayer) {
                    var contents = layer.property("ADBE Root Vectors Group");
                    if (contents) {
                        return restoreShapeColor(contents, change);
                    }
                }
            }

            if (propertyType.indexOf('effect:') === 0) {
                var effects = layer.property("ADBE Effect Parade");
                if (effects) {
                    return restoreEffectColor(effects, change);
                }
            }

            return false;
        });
    } catch (e) {
        return false;
    }
}

function restoreKeyframeColor(change) {
    try {
        var comp = findCompByID(change.compID);
        if (!comp) return false;

        var layer = comp.layer(change.layerID);
        if (!layer || layer.name !== change.layerName) return false;

        return withUnlockedLayer(layer, function () {
            var prop = findColorProperty(layer, change.propertyType, change.newColor, true);
            if (!prop || prop.numKeys === 0) return false;

            var ki = change.keyIndex;
            if (ki > prop.numKeys) return false;

            var currentHex = rgbToHex(prop.keyValue(ki));
            if (currentHex.toLowerCase() === change.newColor.toLowerCase()) {
                var oldRGB = hexToRgb(change.oldColor);
                var currentAlpha = prop.keyValue(ki)[3];
                oldRGB[3] = (currentAlpha !== undefined) ? currentAlpha : 1;

                prop.setValueAtKey(ki, oldRGB);
                return true;
            }

            return false;
        });
    } catch (e) {
        return false;
    }
}

function restoreShapeColor(group, change) {
    for (var i = 1; i <= group.numProperties; i++) {
        var prop = group.property(i);

        if (change.propertyType === 'shapeFill' && prop.matchName === "ADBE Vector Graphic - Fill") {
            try {
                var fillProp = prop.property("ADBE Vector Fill Color");
                var currentHex = rgbToHex(fillProp.value);

                if (currentHex.toLowerCase() === change.newColor.toLowerCase()) {
                    var oldRGB = hexToRgb(change.oldColor);
                    oldRGB[3] = fillProp.value[3]; // preserve alpha
                    fillProp.setValue(oldRGB);
                    return true;
                }
            } catch (e) {}
        }

        if (change.propertyType === 'shapeStroke' && prop.matchName === "ADBE Vector Graphic - Stroke") {
            try {
                var strokeProp = prop.property("ADBE Vector Stroke Color");
                var currentHex2 = rgbToHex(strokeProp.value);

                if (currentHex2.toLowerCase() === change.newColor.toLowerCase()) {
                    var oldRGB2 = hexToRgb(change.oldColor);
                    oldRGB2[3] = strokeProp.value[3]; // preserve alpha
                    strokeProp.setValue(oldRGB2);
                    return true;
                }
            } catch (e) {}
        }

        if (prop.numProperties && prop.numProperties > 0) {
            if (restoreShapeColor(prop, change)) {
                return true;
            }
        }
    }
    return false;
}

function restoreEffectColor(effects, change) {
    for (var e = 1; e <= effects.numProperties; e++) {
        var effect = effects.property(e);
        var effectName = change.propertyType.replace('effect:', '');

        if (effect.name === effectName) {
            return restoreEffectPropertyColor(effect, change);
        }
    }
    return false;
}

function restoreEffectPropertyColor(effect, change) {
    for (var p = 1; p <= effect.numProperties; p++) {
        try {
            var prop = effect.property(p);
            if (prop.propertyValueType === PropertyValueType.COLOR) {
                var currentHex = rgbToHex(prop.value);

                if (currentHex.toLowerCase() === change.newColor.toLowerCase()) {
                    var oldRGB = hexToRgb(change.oldColor);
                    oldRGB[3] = prop.value[3]; // preserve alpha
                    prop.setValue(oldRGB);
                    return true;
                }
            }
            if (prop.numProperties && prop.numProperties > 0) {
                if (restoreEffectPropertyColor(prop, change)) {
                    return true;
                }
            }
        } catch (e) {}
    }
    return false;
}

function findCompByID(compID) {
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof CompItem && item.id === compID) {
            return item;
        }
    }
    return null;
}

function addColor(colorMap, hex, layerName, type, hasExpression) {
    if (!colorMap[hex]) {
        colorMap[hex] = {
            count: 0,
            locations: [],
            expressionCount: 0
        };
    }
    colorMap[hex].count++;
    colorMap[hex].locations.push({
        layer: layerName,
        type: type
    });
    if (hasExpression) {
        colorMap[hex].expressionCount++;
    }
}

function findExactSwap(hex, swaps) {
    var hexLower = hex.toLowerCase();

    for (var i = 0; i < swaps.length; i++) {
        if (hexLower === swaps[i].oldColor.toLowerCase()) {
            return swaps[i].newColor;
        }

        if (swaps[i].mergedFrom) {
            for (var m = 0; m < swaps[i].mergedFrom.length; m++) {
                if (hexLower === swaps[i].mergedFrom[m].toLowerCase()) {
                    return swaps[i].newColor;
                }
            }
        }
    }
    return null;
}

function colorsAreSimilar(hex1, hex2, thresholdPercent) {
    var r1 = parseInt(hex1.substring(1, 3), 16);
    var g1 = parseInt(hex1.substring(3, 5), 16);
    var b1 = parseInt(hex1.substring(5, 7), 16);
    var r2 = parseInt(hex2.substring(1, 3), 16);
    var g2 = parseInt(hex2.substring(3, 5), 16);
    var b2 = parseInt(hex2.substring(5, 7), 16);

    var distance = Math.sqrt(
        Math.pow(r1 - r2, 2) +
        Math.pow(g1 - g2, 2) +
        Math.pow(b1 - b2, 2)
    );

    var maxDistance = 441.67;
    var percentDiff = (distance / maxDistance) * 100;

    return percentDiff <= thresholdPercent;
}

function rgbToHex(color) {
    var r = Math.round(color[0] * 255);
    var g = Math.round(color[1] * 255);
    var b = Math.round(color[2] * 255);
    return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

function componentToHex(c) {
    var hex = c.toString(16);
    return hex.length === 1 ? "0" + hex : hex;
}

function hexToRgb(hex) {
    var r = parseInt(hex.substring(1, 3), 16) / 255;
    var g = parseInt(hex.substring(3, 5), 16) / 255;
    var b = parseInt(hex.substring(5, 7), 16) / 255;
    return [r, g, b, 1];
}

function withUnlockedLayer(layer, worker) {
    var wasLocked = layer.locked;
    try {
        if (wasLocked) layer.locked = false;
        return worker();
    } catch (e) {
        throw e;
    } finally {
        if (wasLocked) {
            try { layer.locked = true; } catch (ignore) {}
        }
    }
}

function selectLayersByColor(argsJSON) {
    var args = JSON.parse(argsJSON);
    var colors = args.colors;
    var includePrecomps = args.includePrecomps;

    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        return JSON.stringify({ count: 0, layers: [] });
    }

    var colorList = [];
    for (var c = 0; c < colors.length; c++) {
        colorList.push(colors[c].toLowerCase());
    }

    for (var d = 1; d <= comp.numLayers; d++) {
        comp.layer(d).selected = false;
    }

    var selectedNames = [];
    var count = 0;

    count += selectInComp(comp, colorList, includePrecomps, selectedNames);

    return JSON.stringify({ count: count, layers: selectedNames });
}

function selectInComp(comp, colorList, includePrecomps, selectedNames) {
    var count = 0;

    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);

        if (layerContainsColor(layer, colorList)) {
            layer.selected = true;
            selectedNames.push(layer.name);
            count++;
        }

        if (includePrecomps && layer.source instanceof CompItem) {
            for (var d = 1; d <= layer.source.numLayers; d++) {
                layer.source.layer(d).selected = false;
            }
            var precompCount = selectInComp(layer.source, colorList, true, selectedNames);
            if (precompCount > 0) {
                layer.selected = true;
                if (selectedNames.indexOf(layer.name) === -1) {
                    selectedNames.push(layer.name + " (precomp)");
                }
                count += precompCount;
            }
        }
    }

    return count;
}

function layerContainsColor(layer, colorList) {
    if (layer instanceof AVLayer && layer.source instanceof SolidSource) {
        var solidHex = rgbToHex(layer.source.mainSource.color).toLowerCase();
        if (colorListContains(colorList, solidHex)) return true;
    }

    if (layer instanceof TextLayer) {
        try {
            var textProp = layer.property("ADBE Text Properties").property("ADBE Text Document");
            var textDoc = textProp.value;

            if (textDoc.fillColor) {
                var fillHex = rgbToHex(textDoc.fillColor).toLowerCase();
                if (colorListContains(colorList, fillHex)) return true;
            }
            if (textDoc.strokeColor) {
                var strokeHex = rgbToHex(textDoc.strokeColor).toLowerCase();
                if (colorListContains(colorList, strokeHex)) return true;
            }
        } catch (e) {}
    }

    if (layer instanceof ShapeLayer) {
        var contents = layer.property("ADBE Root Vectors Group");
        if (contents && shapeTreeContainsColor(contents, colorList)) return true;
    }

    var effects = layer.property("ADBE Effect Parade");
    if (effects) {
        for (var e = 1; e <= effects.numProperties; e++) {
            if (effectContainsColor(effects.property(e), colorList)) return true;
        }
    }

    return false;
}

function shapeTreeContainsColor(group, colorList) {
    for (var i = 1; i <= group.numProperties; i++) {
        var prop = group.property(i);

        if (prop.matchName === "ADBE Vector Graphic - Fill") {
            try {
                var fillProp = prop.property("ADBE Vector Fill Color");
                // Check static value
                var fillHex = rgbToHex(fillProp.value).toLowerCase();
                if (colorListContains(colorList, fillHex)) return true;
                // Check keyframe values
                for (var k = 1; k <= fillProp.numKeys; k++) {
                    var kHex = rgbToHex(fillProp.keyValue(k)).toLowerCase();
                    if (colorListContains(colorList, kHex)) return true;
                }
            } catch (e) {}
        }

        if (prop.matchName === "ADBE Vector Graphic - Stroke") {
            try {
                var strokeProp = prop.property("ADBE Vector Stroke Color");
                var strokeHex = rgbToHex(strokeProp.value).toLowerCase();
                if (colorListContains(colorList, strokeHex)) return true;
                for (var k2 = 1; k2 <= strokeProp.numKeys; k2++) {
                    var kHex2 = rgbToHex(strokeProp.keyValue(k2)).toLowerCase();
                    if (colorListContains(colorList, kHex2)) return true;
                }
            } catch (e) {}
        }

        if (prop.numProperties && prop.numProperties > 0) {
            if (shapeTreeContainsColor(prop, colorList)) return true;
        }
    }
    return false;
}

function effectContainsColor(effect, colorList) {
    for (var p = 1; p <= effect.numProperties; p++) {
        try {
            var prop = effect.property(p);
            if (prop.propertyValueType === PropertyValueType.COLOR) {
                var hex = rgbToHex(prop.value).toLowerCase();
                if (colorListContains(colorList, hex)) return true;
                for (var k = 1; k <= prop.numKeys; k++) {
                    var kHex = rgbToHex(prop.keyValue(k)).toLowerCase();
                    if (colorListContains(colorList, kHex)) return true;
                }
            }
            if (prop.numProperties && prop.numProperties > 0) {
                if (effectContainsColor(prop, colorList)) return true;
            }
        } catch (e) {}
    }
    return false;
}

function colorListContains(list, hex) {
    for (var i = 0; i < list.length; i++) {
        if (list[i] === hex) return true;
    }
    return false;
}

$.global.scanColors = scanColors;
$.global.swapColors = swapColors;
$.global.undoSwap = undoSwap;
$.global.selectLayersByColor = selectLayersByColor;