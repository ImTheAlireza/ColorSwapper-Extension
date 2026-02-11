/**
 * CSInterface - Minimal working version for Adobe CEP (AE 2022-2025+)
 */
function CSInterface() {
    // nothing needed
}

CSInterface.prototype.evalScript = function (script, callback) {
    if (callback === null || callback === undefined) {
        callback = function (result) {};
    }
    window.__adobe_cep__.evalScript(script, callback);
};

CSInterface.prototype.getSystemPath = function (pathType) {
    var path = decodeURI(window.__adobe_cep__.getSystemPath(pathType));
    return path;
};

CSInterface.prototype.getExtensionID = function () {
    return window.__adobe_cep__.getExtensionId();
};

CSInterface.prototype.addEventListener = function (type, listener, obj) {
    window.__adobe_cep__.addEventListener(type, listener, obj);
};

CSInterface.prototype.removeEventListener = function (type, listener, obj) {
    window.__adobe_cep__.removeEventListener(type, listener, obj);
};

CSInterface.prototype.dispatchEvent = function (event) {
    if (typeof event.data === "undefined") {
        event.data = "";
    }
    window.__adobe_cep__.dispatchEvent(JSON.stringify(event));
};

CSInterface.prototype.getHostEnvironment = function () {
    return JSON.parse(window.__adobe_cep__.getHostEnvironment());
};

CSInterface.prototype.getScaleFactor = function () {
    return window.__adobe_cep__.getScaleFactor();
};

var SystemPath = {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension",
    HOST_APPLICATION: "hostApplication"
};