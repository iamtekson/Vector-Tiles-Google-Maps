class MVTSource {
    constructor(map, options) {
        var self = this;
        this.map = map;
        this.options = {
            debug: options.debug || false,
            url: options.url || "", //URL TO Vector Tile Source,
            getIDForLayerFeature: function () { },
            tileSize: 256,
            visibleLayers: options.visibleLayers || [],
            xhrHeaders: {},
            clickableLayers: options.clickableLayers || false,
            onClick: options.onClick || function () { },
            filter : options.filter || false
        };

        this.tileSize = new google.maps.Size(this.options.tileSize, this.options.tileSize);

        this.layers = {}; //Keep a list of the layers contained in the PBFs
        this.processedTiles = {}; //Keep a list of tiles that have been processed already
        this._eventHandlers = {};
        this._triggerOnTilesLoadedEvent = true; //whether or not to fire the onTilesLoaded event when all of the tiles finish loading.
        this._url = this.options.url;


        // tiles currently in the viewport
        this.activeTiles = {};

        // thats that have been loaded and drawn
        this.loadedTiles = {};

        /**
         * For some reason, Leaflet has some code that resets the
         * z index in the options object. I'm having trouble tracking
         * down exactly what does this and why, so for now, we should
         * just copy the value to this.zIndex so we can have the right
         * number when we make the subsequent MVTLayers.
         */
        this.zIndex = this.options.zIndex;

        if (typeof options.style === 'function') {
            this.style = options.style;
        }

        if (typeof options.ajaxSource === 'function') {
            this.ajaxSource = options.ajaxSource;
        }

        this.layerLink = options.layerLink;
        this._eventHandlers = {};
        //this._tilesToProcess = 0; //store the max number of tiles to be loaded.  Later, we can use this count to count down PBF loading.

        this.map.addListener("click", function(e) {
            self._onClick(e);
        });
    }

    getTile(coord, zoom, ownerDocument) {
        const canvas = ownerDocument.createElement("canvas");
        canvas.width = this.tileSize.width;
        canvas.height = this.tileSize.height;
        var tilePoint = {
            x: coord.x,
            y: coord.y
        }
        this.drawTile(canvas, tilePoint, zoom);
        return canvas;
    }

    releaseTile(tile) {
    }


    style(feature) {
        var style = {};

        var type = feature.type;
        switch (type) {
            case 1: //'Point'
                style.color = 'rgba(49,79,79,1)';
                style.radius = 5;
                style.selected = {
                    color: 'rgba(255,255,0,0.5)',
                    radius: 6
                };
                break;
            case 2: //'LineString'
                style.color = 'rgba(161,217,155,0.8)';
                style.size = 3;
                style.selected = {
                    color: 'rgba(255,25,0,0.5)',
                    size: 4
                };
                break;
            case 3: //'Polygon'
                style.color = 'rgba(49,79,79,1)';
                style.outline = {
                    color: 'rgba(161,217,155,0.8)',
                    size: 1
                };
                style.selected = {
                    color: 'rgba(255,140,0,0.3)',
                    outline: {
                        color: 'rgba(255,140,0,1)',
                        size: 2
                    }
                };
                break;
        }
        return style;
    }


    //onAdd(map) {
    //    console.log("onadd")
    //    var self = this;
    //    self.map = map;
    //    L.TileLayer.Canvas.prototype.onAdd.call(this, map);

    //    var mapOnClickCallback = function (e) {
    //        self._onClick(e);
    //    };

    //    map.on('click', mapOnClickCallback);

    //    map.on("layerremove", function (e) {
    //        // check to see if the layer removed is this one
    //        // call a method to remove the child layers (the ones that actually have something drawn on them).
    //        if (e.layer._leaflet_id === self._leaflet_id && e.layer.removeChildLayers) {
    //            e.layer.removeChildLayers(map);
    //            map.off('click', mapOnClickCallback);
    //        }
    //    });

    //    self.addChildLayers(map);

    //    if (typeof DynamicLabel === 'function') {
    //        this.dynamicLabel = new DynamicLabel(map, this, {});
    //    }

    //}

    drawTile(canvas, tilePoint, zoom) {
        var ctx = {
            id: [zoom, tilePoint.x, tilePoint.y].join(":"),
            canvas: canvas,
            tile: tilePoint,
            zoom: zoom,
            tileSize: this.options.tileSize
        };

        //Capture the max number of the tiles to load here. this._tilesToProcess is an internal number we use to know when we've finished requesting PBFs.
        //if (this._tilesToProcess < this._tilesToLoad) {
        //    this._tilesToProcess = this._tilesToLoad;
        //}

        var id = ctx.id = Util.getContextID(ctx);
        this.activeTiles[id] = ctx;

        if (!this.processedTiles[ctx.zoom]) {
            this.processedTiles[ctx.zoom] = {};
        }

        //if (this.options.debug) {
        //    this._drawDebugInfo(ctx);
        //}
        this._draw(ctx);        
    }

    setOpacity(opacity) {
        this._setVisibleLayersStyle('opacity', opacity);
    }

    setZIndex(zIndex) {
        this._setVisibleLayersStyle('zIndex', zIndex);
    }

    _setVisibleLayersStyle(style, value) {
        for (var key in this.layers) {
            this.layers[key]._tileContainer.style[style] = value;
        }
    }

    _drawDebugInfo(ctx) {
        var max = this.options.tileSize;
        var g = ctx.canvas.getContext('2d');
        g.strokeStyle = '#000000';
        g.fillStyle = '#FFFF00';
        g.strokeRect(0, 0, max, max);
        g.font = "12px Arial";
        g.fillRect(0, 0, 5, 5);
        g.fillRect(0, max - 5, 5, 5);
        g.fillRect(max - 5, 0, 5, 5);
        g.fillRect(max - 5, max - 5, 5, 5);
        g.fillRect(max / 2 - 5, max / 2 - 5, 10, 10);
        g.strokeText(ctx.zoom + ' ' + ctx.tile.x + ' ' + ctx.tile.y, max / 2 - 30, max / 2 - 10);
    }

    _draw(ctx) {
        var self = this;

        //    //This works to skip fetching and processing tiles if they've already been processed.
        //    var vectorTile = this.processedTiles[ctx.zoom][ctx.id];
        //    //if we've already parsed it, don't get it again.
        //    if(vectorTile){
        //      console.log("Skipping fetching " + ctx.id);
        //      self.checkVectorTileLayers(parseVT(vectorTile), ctx, true);
        //      self.reduceTilesToProcessCount();
        //      return;
        //    }

        if (!this._url) return;
        var src = this._url
            .replace("{z}", ctx.zoom)
            .replace("{x}", ctx.tile.x)
            .replace("{y}", ctx.tile.y);

        var xhr = new XMLHttpRequest();
        xhr.onload = function () {
            if (xhr.status == "200") {
                if (!xhr.response) return;

                var arrayBuffer = new Uint8Array(xhr.response);
                var buf = new Pbf(arrayBuffer);
                var vt = new VectorTile(buf);
                //Check the current map layer zoom.  If fast zooming is occurring, then short circuit tiles that are for a different zoom level than we're currently on.
                if (self.map && self.map.getZoom() != ctx.zoom) {                    
                    return;
                }

                var vt = parseVT(vt);
                self.checkVectorTileLayers(vt, ctx);
                tileLoaded(self, ctx);
            }
           
            //either way, reduce the count of tilesToProcess tiles here
            //self.reduceTilesToProcessCount();

            if (self.options.debug) {
                self._drawDebugInfo(ctx);
            }
        };

        xhr.onerror = function () {
            console.log("xhr error: " + xhr.status)
        };

        xhr.open('GET', src, true); //async is true
        var headers = self.options.xhrHeaders;
        for (var header in headers) {
            xhr.setRequestHeader(header, headers[header])
        }
        xhr.responseType = 'arraybuffer';
        xhr.send();
    }

    //reduceTilesToProcessCount() {
    //    this._tilesToProcess--;        
    //    if (!this._tilesToProcess) {
    //        //Trigger event letting us know that all PBFs have been loaded and processed (or 404'd).
    //        if (this._eventHandlers["PBFLoad"]) this._eventHandlers["PBFLoad"]();
    //        this._pbfLoaded();
    //    }
    //}

    checkVectorTileLayers(vt, ctx, parsed) {
        var self = this;
        //Check if there are specified visible layers        
        if (self.options.visibleLayers && self.options.visibleLayers.length > 0) {
            //only let thru the layers listed in the visibleLayers array
            for (var i = 0; i < self.options.visibleLayers.length; i++) {
                var layerName = self.options.visibleLayers[i];
                if (vt.layers[layerName]) {
                    //Proceed with parsing
                    self.prepareMVTLayers(vt.layers[layerName], layerName, ctx, parsed);
                }
            }
        } else {
            //Parse all vt.layers
            for (var key in vt.layers) {
                self.prepareMVTLayers(vt.layers[key], key, ctx, parsed);
            }
        }
    }

    prepareMVTLayers(lyr, key, ctx, parsed) {
        var self = this;

        if (!self.layers[key]) {
            //Create MVTLayer or MVTPointLayer for user
            self.layers[key] = self.createMVTLayer(key, lyr.parsedFeatures[0].type || null);
        }
        if (parsed) {
            //We've already parsed it.  Go get canvas and draw.
            self.layers[key].getCanvas(ctx, lyr);
        } else {
            self.layers[key].parseVectorTileLayer(lyr, ctx);
        }

    }

    createMVTLayer(key, type) {
        var self = this;

        var getIDForLayerFeature;
        if (typeof self.options.getIDForLayerFeature === 'function') {
            getIDForLayerFeature = self.options.getIDForLayerFeature;
        } else {
            getIDForLayerFeature = Util.getIDForLayerFeature;
        }

        var options = {
            getIDForLayerFeature: getIDForLayerFeature,
            filter: self.options.filter,
            layerOrdering: self.options.layerOrdering,
            style: self.style,
            name: key,
            asynch: true
        };        

        if (self.options.zIndex) {
            options.zIndex = self.zIndex;
        }

        //Take the layer and create a new MVTLayer or MVTPointLayer if one doesn't exist.
        //var layer = new MVTLayer(self, options).addTo(self.map);
        var layer = new MVTLayer(self, options);

        return layer;
    }

    getLayers() {
        return this.layers;
    }

    hideLayer(id) {
        if (this.layers[id]) {
            this.map.removeLayer(this.layers[id]);
            if (this.options.visibleLayers.indexOf("id") > -1) {
                this.visibleLayers.splice(this.options.visibleLayers.indexOf("id"), 1);
            }
        }
    }

    showLayer(id) {
        if (this.layers[id]) {
            this.map.addLayer(this.layers[id]);
            if (this.options.visibleLayers.indexOf("id") == -1) {
                this.visibleLayers.push(id);
            }
        }
        //Make sure manager layer is always in front
        this.bringToFront();
    }

    removeChildLayers(map) {
        //Remove child layers of this group layer
        for (var key in this.layers) {
            var layer = this.layers[key];
            map.removeLayer(layer);
        }
    }

    addChildLayers(map) {
        var self = this;
        if (self.options.visibleLayers.length > 0) {
            //only let thru the layers listed in the visibleLayers array
            for (var i = 0; i < self.options.visibleLayers.length; i++) {
                var layerName = self.options.visibleLayers[i];
                var layer = this.layers[layerName];
                if (layer) {
                    //Proceed with parsing
                    map.addLayer(layer);
                }
            }
        } else {
            //Add all layers
            for (var key in this.layers) {
                var layer = this.layers[key];
                // layer is set to visible and is not already on map
                if (!layer.map) {
                    map.addLayer(layer);
                }
            }
        }
    }

    bind(eventType, callback) {
        this._eventHandlers[eventType] = callback;
    }

    _onClick(evt) {
        //Here, pass the event on to the child MVTLayer and have it do the hit test and handle the result.
        var self = this;
        var onClick = self.options.onClick;
        var clickableLayers = self.options.clickableLayers;
        var layers = self.layers;
        var zoom = this.map.getZoom();

        //evt.tileID = getTileURL(evt.latlng.lat, evt.latlng.lng, this.map.getZoom());
        evt.tileID = getTileURL(evt.latLng, zoom, this.options.tileSize);

        var x = evt.tileID.split(':')[1];
        var y = evt.tileID.split(':')[2];

        var bounds = MERCATOR.getTileBounds({
            x: x,
            y: y,
            z: zoom
        });

        var sw = new google.maps.LatLng(bounds.sw);        
        var ne = new google.maps.LatLng(bounds.ne);        
        sw = fromLatLngToPoint(sw, this.map);
        ne = fromLatLngToPoint(ne, this.map);                
        
        evt.canvas_x = sw.x;
        evt.canvas_y = ne.y;
        
        // We must have an array of clickable layers, otherwise, we just pass
        // the event to the public onClick callback in options.

        if (!clickableLayers) {
            clickableLayers = Object.keys(self.layers);
            
        }
        if (clickableLayers && clickableLayers.length > 0) {
            for (var i = 0, len = clickableLayers.length; i < len; i++) {
                var key = clickableLayers[i];
                var layer = layers[key];
                if (layer) {
                    layer.handleClickEvent(evt, function (evt) {
                        if (typeof onClick === 'function') {
                            onClick(evt);
                        }
                    });
                }
            }
        } else {
            if (typeof onClick === 'function') {
                onClick(evt);
            }
        }

    }

    setFilter(filterFunction, layerName) {
        //take in a new filter function.
        //Propagate to child layers.

        //Add filter to all child layers if no layer is specified.
        for (var key in this.layers) {
            var layer = this.layers[key];

            if (layerName) {
                if (key.toLowerCase() == layerName.toLowerCase()) {
                    layer.options.filter = filterFunction; //Assign filter to child layer, only if name matches
                    //After filter is set, the old feature hashes are invalid.  Clear them for next draw.
                    layer.clearLayerFeatureHash();
                    //layer.clearTileFeatureHash();
                }
            }
            else {
                layer.options.filter = filterFunction; //Assign filter to child layer
                //After filter is set, the old feature hashes are invalid.  Clear them for next draw.
                layer.clearLayerFeatureHash();
                //layer.clearTileFeatureHash();
            }
        }
    }

    /**
     * Take in a new style function and propogate to child layers.
     * If you do not set a layer name, it resets the style for all of the layers.
     * @param styleFunction
     * @param layerName
     */
    setStyle(styleFn, layerName) {
        for (var key in this.layers) {
            var layer = this.layers[key];
            if (layerName) {
                if (key.toLowerCase() == layerName.toLowerCase()) {
                    layer.setStyle(styleFn);
                }
            } else {
                layer.setStyle(styleFn);
            }
        }
    }

    featureSelected(mvtFeature) {
        if (this.options.mutexToggle) {
            if (this._selectedFeature) {
                this._selectedFeature.deselect();
            }
            this._selectedFeature = mvtFeature;
        }
        if (this.options.onSelect) {
            this.options.onSelect(mvtFeature);
        }
    }

    featureDeselected(mvtFeature) {
        if (this.options.mutexToggle && this._selectedFeature) {
            this._selectedFeature = null;
        }
        if (this.options.onDeselect) {
            this.options.onDeselect(mvtFeature);
        }
    }

    //_pbfLoaded() {
    //    //Fires when all tiles from this layer have been loaded and drawn (or 404'd).

    //    //Make sure manager layer is always in front
    //    this.bringToFront();

    //    //See if there is an event to execute
    //    var self = this;
    //    var onTilesLoaded = self.options.onTilesLoaded;

    //    if (onTilesLoaded && typeof onTilesLoaded === 'function' && this._triggerOnTilesLoadedEvent === true) {
    //        onTilesLoaded(this);
    //    }
    //    self._triggerOnTilesLoadedEvent = true; //reset - if redraw() is called with the optinal 'false' parameter to temporarily disable the onTilesLoaded event from firing.  This resets it back to true after a single time of firing as 'false'.
    //}
}


if (typeof (Number.prototype.toRad) === "undefined") {
    Number.prototype.toRad = function () {
        return this * Math.PI / 180;
    }
}

//function getTileURL(lat, lon, zoom) {
//    var xtile = parseInt(Math.floor((lon + 180) / 360 * (1 << zoom)));
//    var ytile = parseInt(Math.floor((1 - Math.log(Math.tan(lat.toRad()) + 1 / Math.cos(lat.toRad())) / Math.PI) / 2 * (1 << zoom)));
//    return "" + zoom + ":" + xtile + ":" + ytile;
//}

function getTileURL(latLng, zoom, tile_size) {
    const worldCoordinate = project(latLng, tile_size);
    const scale = 1 << zoom;
    const tileCoordinate = new google.maps.Point(
        Math.floor((worldCoordinate.x * scale) / tile_size),
        Math.floor((worldCoordinate.y * scale) / tile_size)
    );
    return "" + zoom + ":" + tileCoordinate.x + ":" + tileCoordinate.y;
}

function project(latLng, tile_size) {
    let siny = Math.sin((latLng.lat() * Math.PI) / 180);
    siny = Math.min(Math.max(siny, -0.9999), 0.9999);
    return new google.maps.Point(
        tile_size * (0.5 + latLng.lng() / 360),
        tile_size * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI))
    );
}

function tileToLatLng(x , y ,z) {
    var long = tile2long(x, z);
    var lat = tile2long(y, z);
    return {
        lat: lat, long: long
    }
}

function tile2long(x, z) {
    return (x / Math.pow(2, z) * 360 - 180);
}

function tile2lat(y, z) {
    var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
    return (180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))));
}

function tileLoaded(pbfSource, ctx) {
    pbfSource.loadedTiles[ctx.id] = ctx;
}

function parseVT(vt) {
    for (var key in vt.layers) {
        var lyr = vt.layers[key];
        parseVTFeatures(lyr);
    }
    return vt;
}

function parseVTFeatures(vtl) {
    vtl.parsedFeatures = [];
    var features = vtl._features;
    for (var i = 0, len = features.length; i < len; i++) {
        var vtf = vtl.feature(i);
        vtf.coordinates = vtf.loadGeometry();
        vtl.parsedFeatures.push(vtf);
    }
    return vtl;
}

MERCATOR = {

    fromLatLngToPoint: function (latLng) {
        var siny = Math.min(Math.max(Math.sin(latLng.lat * (Math.PI / 180)),
            -.9999),
            .9999);
        return {
            x: 128 + latLng.lng * (256 / 360),
            y: 128 + 0.5 * Math.log((1 + siny) / (1 - siny)) * -(256 / (2 * Math.PI))
        };
    },

    fromPointToLatLng: function (point) {

        return {
            lat: (2 * Math.atan(Math.exp((point.y - 128) / -(256 / (2 * Math.PI)))) -
                Math.PI / 2) / (Math.PI / 180),
            lng: (point.x - 128) / (256 / 360)
        };

    },

    getTileAtLatLng: function (latLng, zoom) {
        var t = Math.pow(2, zoom),
            s = 256 / t,
            p = this.fromLatLngToPoint(latLng);
        return { x: Math.floor(p.x / s), y: Math.floor(p.y / s), z: zoom };
    },

    getTileBounds: function (tile) {
        tile = this.normalizeTile(tile);
        var t = Math.pow(2, tile.z),
            s = 256 / t,
            sw = {
                x: tile.x * s,
                y: (tile.y * s) + s
            },
            ne = {
                x: tile.x * s + s,
                y: (tile.y * s)
            };
        return {
            sw: this.fromPointToLatLng(sw),
            ne: this.fromPointToLatLng(ne)
        }        
    },
   
    normalizeTile: function (tile) {
        var t = Math.pow(2, tile.z);
        tile.x = ((tile.x % t) + t) % t;
        tile.y = ((tile.y % t) + t) % t;
        return tile;
    }
}

function fromLatLngToPoint(latLng, map) {
    var topRight = map.getProjection().fromLatLngToPoint(map.getBounds().getNorthEast());
    var bottomLeft = map.getProjection().fromLatLngToPoint(map.getBounds().getSouthWest());
    var scale = Math.pow(2, map.getZoom());
    var worldPoint = map.getProjection().fromLatLngToPoint(latLng);
    return new google.maps.Point((worldPoint.x - bottomLeft.x) * scale, (worldPoint.y - topRight.y) * scale);
}