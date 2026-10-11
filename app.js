/**
 * RRecV2 Web - High Quality System Audio Recorder
 * HTML5 / Web Audio API / File System Access API / lamejs
 */

(function () {
  'use strict';

  // ========================================================
  // 定数・ビットレート定義
  // ========================================================
  const BITRATE_STEPS = [96, 128, 192, 256, 320]; // 0: 96k, 1: 128k, 2: 192k, 3: 256k, 4: 320k
  const STORAGE_KEY_BITRATE = 'rrec_bitrate_step';
  const STORAGE_KEY_HISTORY = 'rrec_title_history';
  const DB_NAME = 'RRecM_Database';
  const DB_STORE = 'settings';
  const DB_KEY_BG = 'custom_background';
  const DB_KEY_DIR = 'saved_directory_handle';

  // ========================================================
  // DOM 要素の取得
  // ========================================================
  const titleInput = document.getElementById('titleInput');
  const titleSuggestions = document.getElementById('titleSuggestions');
  const bitrateSlider = document.getElementById('bitrateSlider');
  const bitrateDisplay = document.getElementById('bitrateDisplay');
  const sliderMarks = document.querySelectorAll('.slider-marks span');

  const systemStatusDot = document.getElementById('systemStatusDot');
  const systemStatusText = document.getElementById('systemStatusText');
  const onAirFrame = document.getElementById('onAirFrame');
  const recBlinker = document.getElementById('recBlinker');
  const recStateLabel = document.getElementById('recStateLabel');
  const timerDigits = document.getElementById('timerDigits');
  const meterBarL = document.getElementById('meterBarL');
  const meterBarR = document.getElementById('meterBarR');
  const audioSpecInfo = document.getElementById('audioSpecInfo');
  const currentDirTag = document.getElementById('currentDirTag');

  const btnRecordToggle = document.getElementById('btnRecordToggle');
  const recBtnIcon = document.getElementById('recBtnIcon');
  const recBtnCaption = document.getElementById('recBtnCaption');
  const btnSelectDir = document.getElementById('btnSelectDir');
  const btnChangeBg = document.getElementById('btnChangeBg');
  const btnCloseApp = document.getElementById('btnCloseApp');
  const bgFileInput = document.getElementById('bgFileInput');

  const encodeModal = document.getElementById('encodeModal');
  const encodeProgressFill = document.getElementById('encodeProgressFill');
  const encodeProgressText = document.getElementById('encodeProgressText');
  const toastBox = document.getElementById('toastBox');
  const toastMessage = document.getElementById('toastMessage');

  // ========================================================
  // アプリケーション状態変数
  // ========================================================
  let isRecording = false;
  let audioContext = null;
  let mediaStream = null;
  let scriptProcessor = null;
  let analyserL = null;
  let analyserR = null;
  let meterAnimationId = null;

  let leftChunks = [];
  let rightChunks = [];
  let recordingStartTime = 0;
  let timerInterval = null;

  let selectedDirHandle = null;
  let toastTimer = null;

  // ========================================================
  // 1. IndexedDB ヘルパー (背景画像の大容量保存用)
  // ========================================================
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveBackgroundToDB(dataUrlOrBlob) {
    try {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        const store = tx.objectStore(DB_STORE);
        const req = store.put(dataUrlOrBlob, DB_KEY_BG);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('IndexedDB 保存エラー:', e);
    }
  }

  async function loadBackgroundFromDB() {
    try {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const store = tx.objectStore(DB_STORE);
        const req = store.get(DB_KEY_BG);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('IndexedDB 読み込みエラー:', e);
    }
  }

  async function saveDirectoryHandleToDB(handle) {
    try {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        const store = tx.objectStore(DB_STORE);
        const req = store.put(handle, DB_KEY_DIR);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('IndexedDB フォルダハンドル保存エラー:', e);
    }
  }

  async function loadDirectoryHandleFromDB() {
    try {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const store = tx.objectStore(DB_STORE);
        const req = store.get(DB_KEY_DIR);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('IndexedDB フォルダハンドル読み込みエラー:', e);
      return null;
    }
  }

  // ========================================================
  // 2. トースト通知表示ヘルパー
  // ========================================================
  function showToast(message, type = 'info', duration = 3500) {
    if (toastTimer) clearTimeout(toastTimer);
    toastMessage.textContent = message;
    toastBox.className = `toast ${type} show`;
    toastTimer = setTimeout(() => {
      toastBox.className = 'toast';
    }, duration);
  }

  // ========================================================
  // 3. タイトル履歴 (localStorage & <datalist>)
  // ========================================================
  function getTitleHistory() {
    try {
      const json = localStorage.getItem(STORAGE_KEY_HISTORY);
      return json ? JSON.parse(json) : [];
    } catch {
      return [];
    }
  }

  function addTitleHistory(title) {
    if (!title || !title.trim()) return;
    const cleanTitle = title.trim();
    let history = getTitleHistory();
    // 重複を削除し先頭に追加
    history = [cleanTitle, ...history.filter(item => item !== cleanTitle)];
    if (history.length > 10) history = history.slice(0, 10);
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
    renderTitleSuggestions();
  }

  function renderTitleSuggestions() {
    const history = getTitleHistory();
    titleSuggestions.innerHTML = '';
    history.forEach(item => {
      const option = document.createElement('option');
      option.value = item;
      titleSuggestions.appendChild(option);
    });
  }

  // ========================================================
  // 4. ビットレートスライダー処理
  // ========================================================
  function updateBitrateDisplay(stepIndex) {
    const step = parseInt(stepIndex, 10) || 0;
    const kbps = BITRATE_STEPS[step] || 192;
    bitrateDisplay.textContent = `${kbps} kbps`;

    // 目盛りのアクティブ表示更新
    sliderMarks.forEach(span => {
      const markStep = parseInt(span.getAttribute('data-step'), 10);
      if (markStep === step) {
        span.classList.add('active');
      } else {
        span.classList.remove('active');
      }
    });

    localStorage.setItem(STORAGE_KEY_BITRATE, step.toString());
  }

  bitrateSlider.addEventListener('input', (e) => {
    updateBitrateDisplay(e.target.value);
  });

  sliderMarks.forEach(span => {
    span.addEventListener('click', () => {
      const step = span.getAttribute('data-step');
      bitrateSlider.value = step;
      updateBitrateDisplay(step);
    });
  });

  function initBitrateSettings() {
    const savedStep = localStorage.getItem(STORAGE_KEY_BITRATE);
    const initialStep = savedStep !== null ? savedStep : '2'; // デフォルト 192kbps
    bitrateSlider.value = initialStep;
    updateBitrateDisplay(initialStep);
  }

  // ========================================================
  // 5. 背景画像管理 (IndexedDB / ファイル選択)
  // ========================================================
  async function initBackground() {
    const savedBg = await loadBackgroundFromDB();
    if (savedBg) {
      document.body.style.backgroundImage = `url('${savedBg}')`;
    }
  }

  btnChangeBg.addEventListener('click', () => {
    bgFileInput.click();
  });

  // 右クリックで初期背景にリセット
  btnChangeBg.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (confirm('背景を初期のスタジオ画像に戻しますか？')) {
      document.body.style.backgroundImage = "url('スタジオ2.jpg')";
      try {
        const db = await openDatabase();
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).delete(DB_KEY_BG);
      } catch {}
      showToast('背景をデフォルトに戻しました', 'info');
    }
  });

  bgFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('画像ファイルを選択してください', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const dataUrl = evt.target.result;
      document.body.style.backgroundImage = `url('${dataUrl}')`;
      await saveBackgroundToDB(dataUrl);
      showToast('背景画像を変更・保存しました', 'success');
    };
    reader.readAsDataURL(file);
    // 連続選択できるようにクリア
    bgFileInput.value = '';
  });

  // ========================================================
  // 6. 保存先ディレクトリ選択 (File System Access API & IndexedDB 保存)
  // ========================================================
  async function initSavedDirectory() {
    if (!window.showDirectoryPicker) return;
    try {
      const handle = await loadDirectoryHandleFromDB();
      if (handle) {
        selectedDirHandle = handle;
        currentDirTag.textContent = `保存先: 📁 ${selectedDirHandle.name}`;
      }
    } catch (e) {
      console.warn('保存先フォルダの復元エラー:', e);
    }
  }

  btnSelectDir.addEventListener('click', async () => {
    if (!window.showDirectoryPicker) {
      showToast('このブラウザはディレクトリ直接保存に対応していません（標準ダウンロードで保存されます）', 'info');
      return;
    }

    try {
      selectedDirHandle = await window.showDirectoryPicker({
        mode: 'readwrite'
      });
      await saveDirectoryHandleToDB(selectedDirHandle);
      currentDirTag.textContent = `保存先: 📁 ${selectedDirHandle.name}`;
      showToast(`保存先フォルダを「${selectedDirHandle.name}」に設定・記憶しました`, 'success');
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('フォルダ選択エラー:', err);
        showToast('保存先フォルダの指定に失敗しました', 'error');
      }
    }
  });

  // ========================================================
  // 7. タイマー・VUメーター制御
  // ========================================================
  function updateTimer() {
    const elapsedMs = Date.now() - recordingStartTime;
    const totalSec = Math.floor(elapsedMs / 1000);
    const hours = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const seconds = String(totalSec % 60).padStart(2, '0');
    timerDigits.textContent = `${hours}:${minutes}:${seconds}`;
  }

  function startVUMeter() {
    if (!analyserL || !analyserR) return;
    const bufL = new Uint8Array(analyserL.frequencyBinCount);
    const bufR = new Uint8Array(analyserR.frequencyBinCount);

    function draw() {
      if (!isRecording) {
        meterBarL.style.width = '0%';
        meterBarR.style.width = '0%';
        return;
      }

      analyserL.getByteTimeDomainData(bufL);
      analyserR.getByteTimeDomainData(bufR);

      // RMS 計算
      let sumL = 0;
      let sumR = 0;
      for (let i = 0; i < bufL.length; i++) {
        const valL = (bufL[i] - 128) / 128;
        const valR = (bufR[i] - 128) / 128;
        sumL += valL * valL;
        sumR += valR * valR;
      }
      const rmsL = Math.min(1, Math.sqrt(sumL / bufL.length) * 3.5);
      const rmsR = Math.min(1, Math.sqrt(sumR / bufR.length) * 3.5);

      meterBarL.style.width = `${Math.round(rmsL * 100)}%`;
      meterBarR.style.width = `${Math.round(rmsR * 100)}%`;

      meterAnimationId = requestAnimationFrame(draw);
    }

    draw();
  }

  function stopVUMeter() {
    if (meterAnimationId) {
      cancelAnimationFrame(meterAnimationId);
      meterAnimationId = null;
    }
    meterBarL.style.width = '0%';
    meterBarR.style.width = '0%';
  }

  // ========================================================
  // 8. 音声キャプチャ & 録音制御
  // ========================================================
  async function startRecording() {
    try {
      // システム音声 (画面/タブ共有) キャプチャダイアログの表示
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2
        }
      });

      // 映像トラックは不要なので直ちに停止・破棄
      const videoTracks = displayStream.getVideoTracks();
      videoTracks.forEach(track => track.stop());

      // 音声トラックが存在するか確認
      const audioTracks = displayStream.getAudioTracks();
      if (!audioTracks || audioTracks.length === 0) {
        displayStream.getTracks().forEach(t => t.stop());
        showToast('⚠️ システム音声が共有されていません。「音声を共有」にチェックを入れてください', 'error', 5000);
        return;
      }

      mediaStream = displayStream;

      // ユーザーがブラウザ標準の「共有を停止」ボタンを押した場合のハンドリング
      audioTracks[0].onended = () => {
        if (isRecording) {
          stopRecording();
        }
      };

      // AudioContext 初期化 (原音 48000Hz サンプルレートを優先)
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioCtxClass({ sampleRate: 48000 });
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const sampleRate = audioContext.sampleRate;
      audioSpecInfo.textContent = `Audio: ${sampleRate.toLocaleString()} Hz / Stereo PCM`;

      const sourceNode = audioContext.createMediaStreamSource(mediaStream);

      // ステレオ用アナライザーとスプリッター
      const splitter = audioContext.createChannelSplitter(2);
      analyserL = audioContext.createAnalyser();
      analyserR = audioContext.createAnalyser();
      analyserL.fftSize = 512;
      analyserR.fftSize = 512;

      sourceNode.connect(splitter);
      splitter.connect(analyserL, 0);
      splitter.connect(analyserR, 1);

      // PCMバッファリング用 ScriptProcessorNode
      const bufferSize = 4096;
      scriptProcessor = audioContext.createScriptProcessor(bufferSize, 2, 2);

      leftChunks = [];
      rightChunks = [];

      scriptProcessor.onaudioprocess = (e) => {
        if (!isRecording) return;
        const leftFloat = e.inputBuffer.getChannelData(0);
        const rightFloat = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : leftFloat;

        // Float32 (-1.0 ~ 1.0) を Int16 (-32768 ~ 32767) に変換して保持
        const leftInt16 = convertFloatToInt16(leftFloat);
        const rightInt16 = convertFloatToInt16(rightFloat);

        leftChunks.push(leftInt16);
        rightChunks.push(rightInt16);
      };

      sourceNode.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

      // 録音状態の更新
      isRecording = true;
      recordingStartTime = Date.now();
      timerInterval = setInterval(updateTimer, 1000);
      updateTimer();

      // UI表示の更新 (録音中)
      if (onAirFrame) onAirFrame.classList.add('is-on-air');
      recBlinker.classList.add('active');
      recStateLabel.textContent = '録音中';
      recStateLabel.classList.add('active');
      systemStatusDot.className = 'status-dot recording';
      systemStatusText.textContent = 'RECORDING';
      btnRecordToggle.classList.add('is-recording');
      recBtnIcon.src = 'stop.png';
      recBtnCaption.textContent = '停止';
      btnRecordToggle.title = '録音を停止してMP3を生成します';

      startVUMeter();
      showToast('録音を開始しました', 'success');
    } catch (err) {
      console.error('録音開始エラー:', err);
      if (err.name === 'NotAllowedError') {
        showToast('画面共有がキャンセルされました', 'info');
      } else {
        showToast(`録音の開始に失敗しました: ${err.message}`, 'error');
      }
    }
  }

  function convertFloatToInt16(floatArray) {
    const len = floatArray.length;
    const int16Array = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      let s = Math.max(-1, Math.min(1, floatArray[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
  }

  async function stopRecording() {
    if (!isRecording) return;
    isRecording = false;

    // タイマー・メーター停止
    clearInterval(timerInterval);
    timerInterval = null;
    stopVUMeter();

    // ストリームおよびAudioContextの切断・停止
    if (scriptProcessor) {
      scriptProcessor.disconnect();
      scriptProcessor.onaudioprocess = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
    }

    const currentSampleRate = audioContext ? audioContext.sampleRate : 48000;
    if (audioContext && audioContext.state !== 'closed') {
      try { await audioContext.close(); } catch {}
    }

    // UIリセット
    if (onAirFrame) onAirFrame.classList.remove('is-on-air');
    recBlinker.classList.remove('active');
    recStateLabel.textContent = '待機中';
    recStateLabel.classList.remove('active');
    systemStatusDot.className = 'status-dot active';
    systemStatusText.textContent = 'ENCODING';
    btnRecordToggle.classList.remove('is-recording');
    recBtnIcon.src = 'rec.png';
    recBtnCaption.textContent = '録音開始';
    btnRecordToggle.title = '録音を開始します';

    // 録音データチェック
    if (leftChunks.length === 0) {
      showToast('録音データがありませんでした', 'info');
      systemStatusDot.className = 'status-dot';
      systemStatusText.textContent = 'STANDBY';
      return;
    }

    // MP3 エンコード処理開始
    await processMp3Encoding(currentSampleRate);
  }

  btnRecordToggle.addEventListener('click', () => {
    if (!isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  });

  // ========================================================
  // 9. MP3 エンコード (Web Worker & フォールバック)
  // ========================================================
  async function processMp3Encoding(sampleRate) {
    // モーダル表示
    encodeModal.classList.add('show');
    encodeProgressFill.style.width = '0%';
    encodeProgressText.textContent = '準備中...';

    // 選択中のビットレート (kbps)
    const step = parseInt(bitrateSlider.value, 10) || 2;
    const kbps = BITRATE_STEPS[step] || 192;

    // チャンクをひとつの Int16Array にマージ
    let totalSamples = 0;
    for (let i = 0; i < leftChunks.length; i++) {
      totalSamples += leftChunks[i].length;
    }

    const mergedLeft = new Int16Array(totalSamples);
    const mergedRight = new Int16Array(totalSamples);
    let offset = 0;
    for (let i = 0; i < leftChunks.length; i++) {
      mergedLeft.set(leftChunks[i], offset);
      mergedRight.set(rightChunks[i], offset);
      offset += leftChunks[i].length;
    }

    // メモリ解放
    leftChunks = [];
    rightChunks = [];

    try {
      let mp3Blob = null;
      // Web Worker によるエンコードの試行
      try {
        mp3Blob = await encodeWithWorker(mergedLeft, mergedRight, sampleRate, kbps);
      } catch (workerErr) {
        console.warn('Web Worker使用不可のためメインスレッドでエンコードします:', workerErr);
        mp3Blob = await encodeOnMainThread(mergedLeft, mergedRight, sampleRate, kbps);
      }

      encodeModal.classList.remove('show');
      systemStatusDot.className = 'status-dot';
      systemStatusText.textContent = 'STANDBY';

      // ファイル保存の実行
      await saveRecordedFile(mp3Blob);

    } catch (err) {
      encodeModal.classList.remove('show');
      systemStatusDot.className = 'status-dot';
      systemStatusText.textContent = 'STANDBY';
      console.error('エンコードエラー:', err);
      showToast(`エンコードに失敗しました: ${err.message}`, 'error');
    }
  }

  // Web Worker でエンコード
  function encodeWithWorker(leftData, rightData, sampleRate, kbps) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker('encoder-worker.js');
      } catch (e) {
        return reject(e);
      }

      worker.onmessage = (e) => {
        const data = e.data;
        if (data.type === 'progress') {
          encodeProgressFill.style.width = `${data.progress}%`;
          encodeProgressText.textContent = `${data.progress}%`;
        } else if (data.type === 'complete') {
          worker.terminate();
          resolve(data.blob);
        } else if (data.type === 'error') {
          worker.terminate();
          reject(new Error(data.error));
        }
      };

      worker.onerror = (e) => {
        worker.terminate();
        reject(new Error(e.message || 'Worker実行時エラー'));
      };

      worker.postMessage({
        channels: 2,
        sampleRate: sampleRate,
        kbps: kbps,
        leftData: leftData,
        rightData: rightData
      });
    });
  }

  // メインスレッドでのフォールバックエンコード (lamejs)
  async function encodeOnMainThread(leftData, rightData, sampleRate, kbps) {
    if (typeof lamejs === 'undefined') {
      throw new Error('lamejs ライブラリが読み込まれていません');
    }

    const mp3encoder = new lamejs.Mp3Encoder(2, sampleRate, kbps);
    const mp3Data = [];
    const sampleBlockSize = 1152;
    const totalSamples = leftData.length;

    let offset = 0;
    while (offset < totalSamples) {
      const leftChunk = leftData.subarray(offset, offset + sampleBlockSize);
      const rightChunk = rightData.subarray(offset, offset + sampleBlockSize);
      const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);

      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }

      offset += sampleBlockSize;

      if (offset % (sampleBlockSize * 150) === 0 || offset >= totalSamples) {
        const progress = Math.min(100, Math.round((offset / totalSamples) * 100));
        encodeProgressFill.style.width = `${progress}%`;
        encodeProgressText.textContent = `${progress}%`;
        // UI ブロックを回避
        await new Promise(r => setTimeout(r, 0));
      }
    }

    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }

    return new Blob(mp3Data, { type: 'audio/mp3' });
  }

  // ========================================================
  // 10. ファイルの保存 (Directory Picker / ダウンロードフォールバック)
  // ========================================================
  async function saveRecordedFile(blob) {
    // 録音停止時のローカル日時: yyyymmddhhmmss (2桁ゼロ埋め)
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${yyyy}${mm}${dd}${hh}${min}${ss}`;

    // タイトル決定 (未入力時は「無題」で補完)
    const inputVal = titleInput.value.trim();
    const baseTitle = inputVal || '無題';
    const sanitizedTitle = baseTitle.replace(/[\/\\:*?"<>|]/g, '_');
    const fileName = `${sanitizedTitle}_${timestamp}.mp3`;

    // 履歴に追加 (ユーザー入力がある場合)
    if (inputVal) {
      addTitleHistory(inputVal);
    }

    // 1. File System Access API でフォルダが設定されている場合 (記憶したハンドルを再利用)
    if (selectedDirHandle && selectedDirHandle.getFileHandle) {
      try {
        let perm = await selectedDirHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          perm = await selectedDirHandle.requestPermission({ mode: 'readwrite' });
        }

        if (perm === 'granted') {
          const fileHandle = await selectedDirHandle.getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();

          showToast(`📁 フォルダ「${selectedDirHandle.name}」に「${fileName}」を直接保存しました`, 'success', 5000);
          return;
        } else {
          showToast('フォルダへの書き込み権限がないため、ダウンロード保存します', 'info');
        }
      } catch (err) {
        console.warn('フォルダへの直接書き込みに失敗しました。ダウンロードにフォールバックします:', err);
      }
    }

    // 2. ブラウザ標準のダウンロード保存フォールバック
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast(`「${fileName}」をダウンロード保存しました`, 'success', 5000);
  }

  // ========================================================
  // 11. 終了処理 (history.back)
  // ========================================================
  btnCloseApp.addEventListener('click', () => {
    if (isRecording) {
      const confirmClose = window.confirm('現在録音中です。録音を破棄してアプリを終了しますか？');
      if (!confirmClose) return;
    }

    if (window.history.length > 1) {
      window.history.back();
    } else {
      showToast('戻るページがありません', 'info');
    }
  });

  // ========================================================
  // 初期化実行
  // ========================================================
  window.addEventListener('DOMContentLoaded', () => {
    initBitrateSettings();
    renderTitleSuggestions();
    initBackground();
    initSavedDirectory();
  });

})();
