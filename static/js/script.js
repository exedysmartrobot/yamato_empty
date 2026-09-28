/* ============================================================
1. 設定
============================================================ */

// 行き先番号 → 走行地点。実運用ではサーバーから取得する
const WAYPOINTS = {
    12: "WP-0012",
    15: "WP-0015",
    21: "WP-0021",
    30: "WP-0030",
    39: "WP-0039",
};

// A / B / C ボタンの行き先番号（WAYPOINTS に登録されている番号を指定する）
const DESTINATIONS = {
    A: 12,
    B: 21,
    C: 30,
};

// バーコードから行き先番号を取り出す（例：「行き先：12」→ 12）
const DESTINATION_PATTERN = /-(\d+)/;

let pendingDestination = null;

// 画面の文言
const TEXTS = {
    ja: {
        stepScan: "選択",
        stepDrive: "走行",
        stepUnload: "荷降ろし",
        stepReturn: "帰還",
        statusWaiting: "待機中",
        statusScanned: "読み取り完了",
        statusDriving: "走行中",
        statusUnloading: "荷降ろし中",
        statusReturning: "帰還中",
        statusDone: "完了",
        statusError: "エラー",
        scanPrompt: "行き先を選んでください",
        destination: "行き先",
        keypadPrompt: "行き先番号を入力",
        notRegistered: "この番号は登録されていません",
        noSpace: "空きスペースが見つかりませんでした",
        navigationError: "走行に失敗しました",
        unloading: "荷降ろし中",
        returning: "出発地へ戻る",
        completed: "搬送完了",
        arrivesIn: "到着まで",
        btnKeypad: "番号入力",
        btnBack: "戻る",
        btnRescan: "読み直す",
        btnBackToSelect: "選択画面へ戻る",
        btnStart: "走行開始",
        btnStop: "停止",
        btnNext: "次へ",
        btnDemo: "次へ（デモ）",
        btnCancel: "キャンセル",
        btnConfirm: "開始する",
        confirmTitle: "この行き先へ搬送しますか？",
    },
    en: {
        stepScan: "Select",
        stepDrive: "Drive",
        stepUnload: "Unload",
        stepReturn: "Return",
        statusWaiting: "Standby",
        statusScanned: "Scanned",
        statusDriving: "Driving",
        statusUnloading: "Unloading",
        statusReturning: "Returning",
        statusDone: "Done",
        statusError: "Error",
        scanPrompt: "Choose a destination",
        destination: "Destination",
        keypadPrompt: "Enter destination number",
        notRegistered: "This number is not registered",
        noSpace: "No available space was found",
        navigationError: "Navigation failed",
        unloading: "Unloading",
        returning: "Returning to start",
        completed: "Delivery complete",
        arrivesIn: "Arrives in",
        btnKeypad: "Enter number",
        btnBack: "Back",
        btnRescan: "Scan again",
        btnBackToSelect: "Back to selection",
        btnStart: "Start driving",
        btnStop: "Stop",
        btnNext: "Next",
        btnDemo: "Next (demo)",
        btnCancel: "Cancel",
        btnConfirm: "Start",
        confirmTitle: "Deliver to this destination?",
    },
};

/* ============================================================
2. 状態
============================================================ */

let currentLanguage = "ja"; // "ja" または "en"
let keypadInput = ""; // テンキーで入力中の番号

// 直近の読み取り結果
let currentItem = {
    rawText: "", // バーコードの生文字列
    number: "", // 行き先番号
    waypoint: "", // 走行地点
};

let number = "";
/* ============================================================
3. 画面の切り替え
============================================================ */

// 画面名 → { 工程バーの位置, ランプの色, ヘッダの状態名 }
const SCREEN_INFO = {
    waiting: { step: -1, lamp: "", status: "statusWaiting" },
    keypad: { step: -1, lamp: "", status: "statusWaiting" },
    error: { step: -1, lamp: "error", status: "statusError" },
    scanned: { step: 0, lamp: "ok", status: "statusScanned" },
    driving: { step: 1, lamp: "busy", status: "statusDriving" },
    unloading: { step: 2, lamp: "busy", status: "statusUnloading" },
    returning: { step: 3, lamp: "busy", status: "statusReturning" },
    done: { step: 4, lamp: "ok", status: "statusDone" },
};

const STEP_IDS = ["step-scan", "step-drive", "step-unload", "step-return"];

let currentScreen = "waiting";

function showScreen(name) {
    currentScreen = name;

    // すべての画面を隠して、指定された画面だけ表示する
    const screens = document.querySelectorAll(".screen");
    screens.forEach(function (screen) {
        screen.classList.remove("active");
    });
    document.getElementById("screen-" + name).classList.add("active");

    // 操作ボタンも同じように切り替える
    const groups = document.querySelectorAll(".action-group");
    groups.forEach(function (group) {
        group.classList.remove("active");
    });
    document.getElementById("actions-" + name).classList.add("active");

    updateHeader(name);
    updateSteps(name);
}

function updateHeader(name) {
    const info = SCREEN_INFO[name];

    const lamp = document.getElementById("lamp");
    lamp.className = info.lamp;

    const statusText = document.getElementById("status-text");
    statusText.textContent = TEXTS[currentLanguage][info.status];
    statusText.dataset.i18n = info.status;
}

function updateSteps(name) {
    const currentStep = SCREEN_INFO[name].step;
    const isFinished = name === "done";

    STEP_IDS.forEach(function (id, index) {
        const step = document.getElementById(id);
        step.classList.remove("done", "current");

        if (isFinished || index < currentStep) {
            step.classList.add("done");
        } else if (index === currentStep) {
            step.classList.add("current");
        }
    });
}

/* ============================================================
4. バーコードの読み取り
============================================================ */

// 読み取った文字列を解析して、対応する画面へ進む
function handleScan(rawText) {
    const matched = rawText.match(DESTINATION_PATTERN);

    // 「行き先：◯◯」の形式で読めなかった
    if (!matched) {
        currentItem = { rawText: rawText, number: "", waypoint: "" };
        showErrorScreen();
        return;
    }

    number = String(Number(matched[1])); // "007" → "7"
    const waypoint = WAYPOINTS[number];

    // 番号は読めたが、waypointが登録されていない
    if (!waypoint) {
        currentItem = { rawText: rawText, number: number, waypoint: "" };
        showErrorScreen();
        return;
    }

    currentItem = {
        rawText: rawText,
        number: number,
        waypoint: waypoint,
    };
    showScannedScreen();
}

function showScannedScreen() {
    document.getElementById("scanned-number").textContent = currentItem.number;
    document.getElementById("scanned-waypoint").textContent = currentItem.waypoint;
    // document.getElementById("scanned-raw").textContent = currentItem.rawText;
    showScreen("scanned");
}

function showErrorScreen() {
    setErrorMessage("notRegistered");
    showScreen("error");
}

function showNoSpaceScreen() {
    setErrorMessage("noSpace");
    showScreen("error");
}

function showNavigationErrorScreen() {
    setErrorMessage("navigationError");
    showScreen("error");
}

function setErrorMessage(key) {
    const messageEl = document.getElementById("error-message");
    messageEl.dataset.i18n = key;
    messageEl.textContent = TEXTS[currentLanguage][key];
}

// バーコードリーダー（キーボードとして振る舞う機種）の入力を拾う。
// リーダーは高速で文字を送り、最後に Enter を送る。
// 人が手で打った場合と区別するため、間隔が空いたらバッファを捨てる。
let scanBuffer = "";
let lastKeyTime = 0;

document.addEventListener("keydown", function (event) {
    // 読み取りを受け付けるのは、待機中とエラー画面のときだけ
    if (currentScreen !== "waiting" && currentScreen !== "error") {
        return;
    }

    const now = Date.now();
    if (now - lastKeyTime > 120) {
        scanBuffer = "";
    }
    lastKeyTime = now;

    if (event.key === "Enter") {
        if (scanBuffer !== "") {
            handleScan(scanBuffer);
        }
        scanBuffer = "";
        return;
    }

    if (event.key.length === 1) {
        scanBuffer += event.key;
    }
});

/* ============================================================
4. ボタンの選択
============================================================ */

// --- 読み取り待ち画面：A / B / C ボタン ---
const destButtons = document.querySelectorAll(".dest-button");
destButtons.forEach(function (button) {
    button.addEventListener("click", function () {
        selectDestination(button.dataset.dest);
    });
});

function selectDestination(station) {
    // すぐ走らせず、確認ポップアップを表示する
    pendingDestination = { station: station, label: "Station" + station };
    document.getElementById("confirm-dest").textContent = "Station" + station;
    document.getElementById("confirm-modal").classList.add("active");
}
//     number = String(destNumber);
//     currentItem = { rawText: station, number: number, waypoint: waypoint };

//     // そのまま走行開始（既存の走行開始ボタンと同じ処理）
//     navStart(currentItem);
//     navigation_start(station);
// }

// --- 確認ポップアップ ---
document.getElementById("confirm-ok").addEventListener("click", function () {
    document.getElementById("confirm-modal").classList.remove("active");
    if (!pendingDestination) {
        return;
    }

    currentItem = {
        rawText: pendingDestination.station,
        label: pendingDestination.label,
    };

    navStart(currentItem);
    navigation_start(pendingDestination.station);
    pendingDestination = null;
});

document.getElementById("confirm-cancel").addEventListener("click", function () {
    document.getElementById("confirm-modal").classList.remove("active");
    pendingDestination = null;
});

/* ============================================================
5. ロボットへの指示（今はダミー）
============================================================ */

function navStart(item) {
    // 走行画面に切り替える
    document.getElementById("driving-number").textContent = item.label || item.number;
    document.getElementById("driving-progress").style.width = "0%";
    showScreen("driving");

    // 進捗バーを動かす（本番ではロボットの現在地から更新する）
    setTimeout(function () {
        document.getElementById("driving-progress").style.width = "62%";
    }, 100);
}

function navCancel() {
    // TODO: main_api("stop");
    console.log("stop");
    showScreen("waiting");
}

/* ============================================================
6. テンキー
============================================================ */

function updateKeypadDisplay() {
    const display = document.getElementById("keypad-display");

    if (keypadInput === "") {
        display.textContent = "– – –";
        display.classList.add("empty");
    } else {
        display.textContent = keypadInput;
        display.classList.remove("empty");
    }
}

/* ============================================================
7. 言語の切り替え
============================================================ */

function applyLanguage(language) {
    currentLanguage = language;

    // data-i18n が付いた要素の文言をまとめて差し替える
    const targets = document.querySelectorAll("[data-i18n]");
    targets.forEach(function (element) {
        const key = element.dataset.i18n;
        element.textContent = TEXTS[language][key];
    });

    // 選択中の言語ボタンに印を付ける
    document.getElementById("lang-ja").classList.toggle("active", language === "ja");
    document.getElementById("lang-en").classList.toggle("active", language === "en");
}

/* ============================================================
8. ボタンの動作
============================================================ */

// --- 読み取り待ち画面 ---
document.getElementById("open-keypad-button").addEventListener("click", function () {
    keypadInput = "";
    updateKeypadDisplay();
    showScreen("keypad");
});

// --- テンキー画面 ---
const digitButtons = document.querySelectorAll(".digit");
digitButtons.forEach(function (button) {
    button.addEventListener("click", function () {
        if (keypadInput.length >= 4) {
            return;
        }
        keypadInput = keypadInput + button.dataset.digit;
        updateKeypadDisplay();
    });
});

document.getElementById("keypad-backspace").addEventListener("click", function () {
    keypadInput = keypadInput.slice(0, -1);
    updateKeypadDisplay();
});

document.getElementById("keypad-confirm").addEventListener("click", function () {
    if (keypadInput === "") {
        return;
    }
    handleScan("-" + keypadInput);
});

document.getElementById("keypad-back-button").addEventListener("click", function () {
    showScreen("waiting");
});

// --- エラー画面 ---
document.getElementById("error-rescan-button").addEventListener("click", function () {
    showScreen("waiting");
});

// --- 読み取り完了画面 ---
document.getElementById("rescan-button").addEventListener("click", function () {
    showScreen("waiting");
});

document.getElementById("start-driving-button").addEventListener("click", function () {
    navStart(currentItem);
    // navCall(currentItem);
    navigation_start(number);
});

// --- 走行中画面 ---
document.getElementById("stop-driving-button").addEventListener("click", function () {
    navCancel();
});

// --- 帰還中画面 ---
document.getElementById("stop-returning-button").addEventListener("click", function () {
    navCancel();
});

document.getElementById("returned-button").addEventListener("click", function () {
    document.getElementById("done-number").textContent = currentItem.number;
    showScreen("done");
});

// --- 完了画面 ---
document.getElementById("next-scan-button").addEventListener("click", function () {
    showScreen("waiting");
});

// --- 言語ボタン ---
document.getElementById("lang-ja").addEventListener("click", function () {
    applyLanguage("ja");
});

document.getElementById("lang-en").addEventListener("click", function () {
    applyLanguage("en");
});

// --- 全画面ボタン ---
document.getElementById("fullscreen-button").addEventListener("click", function () {
    if (document.fullscreenElement) {
        document.exitFullscreen();
    } else {
        document.documentElement.requestFullscreen();
    }
});

/* ============================================================
9. 起動
============================================================ */

applyLanguage("ja");
showScreen("waiting");
