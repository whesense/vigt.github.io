/**
 * BEV (Bird's Eye View) renderer for selection + lidar
 */

import { worldToPlot } from '../utils/coordinateUtils.js';

export class BEVRenderer {
    constructor(canvas, bevRange = [-40, 40, -40, 40], gridSize = 32) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.bevRange = bevRange;
        this.gridSize = gridSize;
    }
    
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    renderLidarPoints(lidarPts, color = 'grey', alpha = 0.1, pointSize = 1) {
        if (!lidarPts || lidarPts.length === 0) return;
        
        this.ctx.save();
        this.ctx.fillStyle = color;
        this.ctx.globalAlpha = alpha;
        
        lidarPts.forEach(pt => {
            const [x, y, z] = pt;
            void (z);
            const [plotX, plotY] = worldToPlot(
                x, y,
                this.bevRange,
                this.canvas.width,
                this.canvas.height
            );
            
            // Match the inverse-attention app convention: flip X axis.
            const flippedX = this.canvas.width - plotX;
            
            if (flippedX >= 0 && flippedX < this.canvas.width &&
                plotY >= 0 && plotY < this.canvas.height) {
                this.ctx.fillRect(flippedX, plotY, pointSize, pointSize);
            }
        });
        
        this.ctx.restore();
    }
    
    renderGrid(color = 'white', alpha = 0.28) {
        const gridSize = this.gridSize;
        const cellWidth = this.canvas.width / gridSize;
        const cellHeight = this.canvas.height / gridSize;
        
        this.ctx.save();
        this.ctx.strokeStyle = color;
        this.ctx.globalAlpha = alpha;
        this.ctx.lineWidth = 1.0;
        
        // Draw minor grid
        for (let x = 0; x <= gridSize; x++) {
            const plotX = this.canvas.width - x * cellWidth;
            this.ctx.beginPath();
            this.ctx.moveTo(plotX, 0);
            this.ctx.lineTo(plotX, this.canvas.height);
            this.ctx.stroke();
        }
        for (let y = 0; y <= gridSize; y++) {
            const plotY = this.canvas.height - y * cellHeight;
            this.ctx.beginPath();
            this.ctx.moveTo(0, plotY);
            this.ctx.lineTo(this.canvas.width, plotY);
            this.ctx.stroke();
        }
        
        // Draw major grid every 4 cells for easier selection
        this.ctx.globalAlpha = Math.min(0.55, alpha + 0.22);
        this.ctx.lineWidth = 1.8;
        for (let x = 0; x <= gridSize; x += 4) {
            const plotX = this.canvas.width - x * cellWidth;
            this.ctx.beginPath();
            this.ctx.moveTo(plotX, 0);
            this.ctx.lineTo(plotX, this.canvas.height);
            this.ctx.stroke();
        }
        for (let y = 0; y <= gridSize; y += 4) {
            const plotY = this.canvas.height - y * cellHeight;
            this.ctx.beginPath();
            this.ctx.moveTo(0, plotY);
            this.ctx.lineTo(this.canvas.width, plotY);
            this.ctx.stroke();
        }
        
        this.ctx.restore();
    }
    
    renderSelectedCell(xIdx, yIdx, color = '#ff2d2d') {
        if (xIdx === null || yIdx === null) return;
        
        const gridSize = this.gridSize;
        const cellWidth = this.canvas.width / gridSize;
        const cellHeight = this.canvas.height / gridSize;
        
        // Match heatmap mapping used in the inverse-attention renderer:
        const plotX = this.canvas.width - (xIdx + 1) * cellWidth;
        const plotY = this.canvas.height - (yIdx + 1) * cellHeight;
        
        this.ctx.save();
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 4;
        this.ctx.globalAlpha = 0.95;
        this.ctx.strokeRect(plotX + 1, plotY + 1, cellWidth - 2, cellHeight - 2);
        
        // semi-transparent fill
        this.ctx.globalAlpha = 0.24;
        this.ctx.fillStyle = color;
        this.ctx.fillRect(plotX, plotY, cellWidth, cellHeight);
        this.ctx.restore();
    }
}
