// MP3 エンコード Web Worker (lamejs 利用)
self.importScripts('lame.min.js');

self.onmessage = function (e) {
  const { channels, sampleRate, kbps, leftData, rightData } = e.data;
  
  try {
    const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
    const mp3Data = [];
    const sampleBlockSize = 1152;
    const totalSamples = leftData.length;

    let offset = 0;
    while (offset < totalSamples) {
      const leftChunk = leftData.subarray(offset, offset + sampleBlockSize);
      const rightChunk = rightData.subarray(offset, offset + sampleBlockSize);

      let mp3buf;
      if (channels === 1) {
        mp3buf = mp3encoder.encodeBuffer(leftChunk);
      } else {
        mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
      }

      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }

      offset += sampleBlockSize;

      // 定期的に進捗通知
      if (offset % (sampleBlockSize * 100) === 0 || offset >= totalSamples) {
        const progress = Math.min(100, Math.round((offset / totalSamples) * 100));
        self.postMessage({ type: 'progress', progress: progress });
      }
    }

    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }

    // Blob 生成用のバッファ
    const blob = new Blob(mp3Data, { type: 'audio/mp3' });
    self.postMessage({ type: 'complete', blob: blob });
  } catch (err) {
    self.postMessage({ type: 'error', error: err.message || 'エンコード中にエラーが発生しました' });
  }
};
