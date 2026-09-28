const SERVER_URL = "http://localhost:5050";
const socket = io(SERVER_URL); // サーバーURLに合わせる

// 待機位置への走行が完了したら、最初のボタン選択画面に戻す
socket.on("navigation_done", function (data) {
    console.log("navigation_done", data);
    showScreen("waiting");
});

// 空きスペースが見つからなかった場合、エラー画面を表示する
socket.on("navigation_no_space", function (data) {
    console.log("navigation_no_space", data);
    showNoSpaceScreen();
});

// 走行に失敗した場合、エラー画面を表示する
socket.on("navigation_error", function (data) {
    console.log("navigation_error", data);
    showNavigationErrorScreen();
});

// 空きスペースへの進入・退出（荷降ろし）フェーズに入ったら画面を切り替える
socket.on("navigation_unloading", function (data) {
    console.log("navigation_unloading", data);
    document.getElementById("unloading-number").textContent = currentItem.label || currentItem.number || "-";
    showScreen("unloading");
});

// 待機位置へ戻るフェーズに入ったら画面を切り替える
socket.on("navigation_returning", function (data) {
    console.log("navigation_returning", data);
    document.getElementById("returning-progress").style.width = "0%";
    showScreen("returning");
});

async function navigation_start(goal) {
    console.log("navigation_start");
    try {
        const response = await fetch(`${SERVER_URL}/navigation_start`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                goal_point: goal,
            }),
        });
        if (response.ok) {
            const data = await response.json();
            console.log(data.status);
        } else {
            console.error("エラーが発生しました。ステータス:", response.status);
            alert("エラーが発生しました");
        }
    } catch (error) {
        console.error("リクエストに失敗しました:", error);
        alert("リクエストに失敗しました");
    }
}
