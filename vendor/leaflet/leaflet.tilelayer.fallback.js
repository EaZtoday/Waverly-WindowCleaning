/*
 * Based on leaflet.tilelayer.fallback (https://github.com/ghybs/Leaflet.TileLayer.Fallback)
 * by ghybs, MIT licence.
 *
 * When a tile is missing at the requested zoom, swap in the parent tile from
 * the next-lower zoom (scaled and clipped to cover the same area), walking
 * down until a tile exists. Lets us request the sharpest imagery everywhere
 * without showing broken tiles where a source has less detail.
 */
(function (L) {
  "use strict";

  L.TileLayer.Fallback = L.TileLayer.extend({
    options: {
      minNativeZoom: 0,
    },

    initialize: function (urlTemplate, options) {
      L.TileLayer.prototype.initialize.call(this, urlTemplate, options);
    },

    createTile: function (coords, done) {
      var tile = L.TileLayer.prototype.createTile.call(this, coords, done);
      tile._originalCoords = coords;
      tile._originalSrc = tile.src;
      return tile;
    },

    _createCurrentCoords: function (originalCoords) {
      var currentCoords = this._wrapCoords(originalCoords);
      currentCoords.fallback = true;
      return currentCoords;
    },

    _originalTileOnError: L.TileLayer.prototype._tileOnError,

    _tileOnError: function (done, tile, e) {
      var layer = this,
        originalCoords = tile._originalCoords,
        currentCoords = (tile._currentCoords =
          tile._currentCoords || layer._createCurrentCoords(originalCoords)),
        fallbackZoom = (tile._fallbackZoom =
          tile._fallbackZoom === undefined
            ? originalCoords.z - 1
            : tile._fallbackZoom - 1),
        scale = (tile._fallbackScale = (tile._fallbackScale || 1) * 2),
        tileSize = layer.getTileSize(),
        style = tile.style,
        newUrl,
        top,
        left;

      // no lower zoom to fall back to: give up like stock Leaflet would
      if (fallbackZoom < layer.options.minNativeZoom) {
        return this._originalTileOnError(done, tile, e);
      }

      currentCoords.z = fallbackZoom;
      currentCoords.x = Math.floor(currentCoords.x / 2);
      currentCoords.y = Math.floor(currentCoords.y / 2);
      newUrl = layer.getTileUrl(currentCoords);

      // enlarge the parent tile and clip it to this tile's quadrant
      style.width = tileSize.x * scale + "px";
      style.height = tileSize.y * scale + "px";
      top = (originalCoords.y - currentCoords.y * scale) * tileSize.y;
      style.marginTop = -top + "px";
      left = (originalCoords.x - currentCoords.x * scale) * tileSize.x;
      style.marginLeft = -left + "px";
      style.clip =
        "rect(" + top + "px " + (left + tileSize.x) + "px " +
        (top + tileSize.y) + "px " + left + "px)";

      layer.fire("tilefallback", {
        tile: tile,
        url: tile._originalSrc,
        urlMissing: tile.src,
        urlFallback: newUrl,
      });

      tile.src = newUrl;
    },

    getTileUrl: function (coords) {
      return coords.z >= this.options.minNativeZoom
        ? L.TileLayer.prototype.getTileUrl.call(this, coords)
        : "";
    },
  });

  L.tileLayer.fallback = function (urlTemplate, options) {
    return new L.TileLayer.Fallback(urlTemplate, options);
  };
})(L);
