/**
 * Camera Gallery Component
 * Displays thumbnail grid of all cameras with selection indicators
 */

export class CameraGallery {
    /**
     * @param {HTMLElement} container - Container element
     * @param {Array<string>} cameraNames - List of camera names
     * @param {Function} onSelect - Callback when camera is selected
     */
    constructor(container, cameraNames, onSelect) {
        this.container = container;
        this.cameraNames = cameraNames;
        this.onSelect = onSelect;
        this.selectedCamera = null;
        this.thumbnails = new Map();
        
        this.render();
    }
    
    /**
     * Render the gallery
     */
    render() {
        this.container.innerHTML = '';
        this.container.className = 'camera-gallery';
        
        this.cameraNames.forEach(camName => {
            const thumbnail = this.createThumbnail(camName);
            this.container.appendChild(thumbnail);
            this.thumbnails.set(camName, thumbnail);
        });
    }
    
    /**
     * Create a thumbnail element for a camera
     */
    createThumbnail(camName) {
        const div = document.createElement('div');
        div.className = 'camera-thumbnail';
        div.dataset.cameraName = camName;
        
        const canvas = document.createElement('canvas');
        canvas.className = 'thumbnail-canvas';
        canvas.width = 150;
        canvas.height = 100;
        
        const label = document.createElement('div');
        label.className = 'thumbnail-label';
        label.textContent = camName;
        
        div.appendChild(canvas);
        div.appendChild(label);
        
        div.addEventListener('click', () => {
            this.selectCamera(camName);
        });
        
        return div;
    }
    
    /**
     * Select a camera (internal - updates UI only)
     */
    selectCamera(camName, skipCallback = false) {
        try {
            // Don't do anything if already selected
            if (this.selectedCamera === camName) {
                return;
            }
            
            // Update visual state
            // Use for...of instead of forEach to avoid potential stack issues
            for (const [name, thumb] of this.thumbnails.entries()) {
                if (name === camName) {
                    thumb.classList.add('selected');
                } else {
                    thumb.classList.remove('selected');
                }
            }
            
            this.selectedCamera = camName;
            
            // Only call callback if not skipping (to avoid infinite recursion)
            if (!skipCallback && this.onSelect) {
                this.onSelect(camName);
            }
        } catch (error) {
            console.error('Error in selectCamera:', error);
            throw error;
        }
    }
    
    /**
     * Update thumbnail image
     */
    updateThumbnail(camName, image, regions = []) {
        try {
            const thumbnail = this.thumbnails.get(camName);
            if (!thumbnail) {
                console.warn(`Thumbnail not found for camera: ${camName}`);
                return;
            }
            
            const canvas = thumbnail.querySelector('.thumbnail-canvas');
            if (!canvas) {
                console.warn(`Canvas not found in thumbnail for: ${camName}`);
                return;
            }
            
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                console.warn(`Could not get 2D context for thumbnail: ${camName}`);
                return;
            }
            
            // Clear and draw image
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Check if image is loaded
            if (!image || !image.width || !image.height) {
                console.warn(`Invalid image for thumbnail: ${camName}`, image);
                return;
            }
            
            // Scale image to fit thumbnail
            const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
            const width = image.width * scale;
            const height = image.height * scale;
            const x = (canvas.width - width) / 2;
            const y = (canvas.height - height) / 2;
            
            ctx.drawImage(image, x, y, width, height);
            
            // Draw region indicators with matching colors
            if (regions && regions.length > 0) {
                ctx.lineWidth = 2;
                // Use for loop instead of forEach to avoid potential stack issues
                for (let i = 0; i < regions.length; i++) {
                    const { xRange, yRange, color = 'yellow' } = regions[i];
                    const [x1, x2] = xRange;
                    const [y1, y2] = yRange;
                    const scaleX = width / image.width;
                    const scaleY = height / image.height;
                    
                    // Use the region's color
                    ctx.strokeStyle = color;
                    ctx.strokeRect(
                        x + x1 * scaleX,
                        y + y1 * scaleY,
                        (x2 - x1) * scaleX,
                        (y2 - y1) * scaleY
                    );
                }
            }
        } catch (error) {
            console.error(`Error updating thumbnail for ${camName}:`, error);
        }
    }
    
    /**
     * Get selected camera
     */
    getSelectedCamera() {
        return this.selectedCamera;
    }
}
