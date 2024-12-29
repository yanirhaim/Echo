// static/audio-processor.worklet.js
class AudioProcessor extends globalThis.AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 4096;
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0]) return true;

        const inputData = input[0];
        
        for (let i = 0; i < inputData.length; i++) {
            this.buffer[this.bufferIndex] = inputData[i];
            this.bufferIndex++;

            if (this.bufferIndex >= this.bufferSize) {
                const audioData = new Float32Array(this.buffer);
                const audio16 = new Int16Array(audioData.length);
                
                for (let j = 0; j < audioData.length; j++) {
                    audio16[j] = Math.max(-32768, Math.min(32767, audioData[j] * 32768));
                }
                
                this.port.postMessage(audio16.buffer, [audio16.buffer]);
                this.bufferIndex = 0;
                this.buffer = new Float32Array(this.bufferSize);
            }
        }
        return true;
    }
}

registerProcessor('audio-processor', AudioProcessor);