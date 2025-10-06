class AudioProcessor {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.recordingInterval = 3000;
    this.silenceThreshold = -50;
    this.audioContext = null;
    this.analyser = null;
    this.source = null;
  }

  async startRecording(stream, onChunkReady) {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.source.connect(this.analyser);

      const options = { mimeType: 'audio/webm' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'audio/ogg';
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          options.mimeType = 'audio/mp4';
          if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = '';
          }
        }
      }

      this.mediaRecorder = new MediaRecorder(stream, options);
      this.audioChunks = [];
      this.isRecording = true;

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        if (this.audioChunks.length > 0) {
          const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
          this.audioChunks = [];

          if (audioBlob.size > 1000) {
            await onChunkReady(audioBlob);
          }
        }

        if (this.isRecording && this.mediaRecorder.state === 'inactive') {
          this.mediaRecorder.start();
          setTimeout(() => {
            if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
              this.mediaRecorder.stop();
            }
          }, this.recordingInterval);
        }
      };

      this.mediaRecorder.start();
      setTimeout(() => {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
          this.mediaRecorder.stop();
        }
      }, this.recordingInterval);

    } catch (error) {
      console.error('Error starting recording:', error);
      throw error;
    }
  }

  stopRecording() {
    this.isRecording = false;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
    this.mediaRecorder = null;
    this.audioChunks = [];
  }

  getAudioLevel() {
    if (!this.analyser) return -100;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    const sum = dataArray.reduce((a, b) => a + b, 0);
    const average = sum / dataArray.length;
    const db = 20 * Math.log10(average / 255);

    return db;
  }
}

class TranslationEngine {
  constructor(myLanguage, remoteLanguage, enableTranslation) {
    this.myLanguage = myLanguage;
    this.remoteLanguage = remoteLanguage;
    this.enableTranslation = enableTranslation;
    this.isProcessing = false;
  }

  async transcribe(audioBlob) {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob);

      const response = await fetch('/api/stt', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('STT request failed');
      }

      const data = await response.json();
      return data.text || '';
    } catch (error) {
      console.error('Transcription error:', error);
      return '';
    }
  }

  async translate(text, targetLanguage) {
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, targetLang: targetLanguage }),
      });

      if (!response.ok) {
        throw new Error('Translation request failed');
      }

      const data = await response.json();
      return data.translated || text;
    } catch (error) {
      console.error('Translation error:', error);
      return text;
    }
  }

  async synthesizeSpeech(text, voice = 'alloy') {
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, format: 'mp3' }),
      });

      if (!response.ok) {
        throw new Error('TTS request failed');
      }

      const audioBlob = await response.blob();
      return audioBlob;
    } catch (error) {
      console.error('TTS error:', error);
      return null;
    }
  }

  async processOutgoingAudio(audioBlob) {
    if (!this.enableTranslation || this.myLanguage === this.remoteLanguage) {
      return { original: '', translated: '' };
    }

    if (this.isProcessing) {
      return { original: '', translated: '' };
    }

    this.isProcessing = true;

    try {
      const transcribed = await this.transcribe(audioBlob);

      if (!transcribed || transcribed.trim().length === 0) {
        this.isProcessing = false;
        return { original: '', translated: '' };
      }

      const translated = await this.translate(transcribed, this.remoteLanguage);

      this.isProcessing = false;
      return { original: transcribed, translated };
    } catch (error) {
      console.error('Error processing outgoing audio:', error);
      this.isProcessing = false;
      return { original: '', translated: '' };
    }
  }

  async playTranslatedAudio(text, audioElement) {
    if (!text || !audioElement) return;

    try {
      const audioBlob = await this.synthesizeSpeech(text);
      if (audioBlob) {
        const audioUrl = URL.createObjectURL(audioBlob);
        const tempAudio = new Audio(audioUrl);
        tempAudio.play();
        tempAudio.onended = () => URL.revokeObjectURL(audioUrl);
      }
    } catch (error) {
      console.error('Error playing translated audio:', error);
    }
  }

  updateSettings(myLanguage, remoteLanguage, enableTranslation) {
    this.myLanguage = myLanguage;
    this.remoteLanguage = remoteLanguage;
    this.enableTranslation = enableTranslation;
  }
}

export { AudioProcessor, TranslationEngine };
