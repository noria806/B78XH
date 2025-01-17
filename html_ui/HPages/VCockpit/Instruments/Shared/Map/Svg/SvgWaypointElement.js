class SvgWaypointElement extends SvgMapElement {
	constructor(source) {
		super();
		this.textOffsetRatio = 0.25;
		this.showText = true;
		this.minimize = false;
		this._alpha = NaN;
		this._textWidth = NaN;
		this._textHeight = NaN;
		this.needRepaint = false;
		this._lastX = 0;
		this._lastY = 0;
		this._lastMinimize = false;
		this._lastIsActiveWaypoint = false;
		this.source = source;
	}

	get ident() {
		if (this._ident) {
			return this._ident;
		}
		if (this.source) {
			return this.source.ident;
		}
	}

	set ident(v) {
		this._ident = v;
	}

	get icao() {
		if (this._icao) {
			return this._icao;
		}
		if (this.source) {
			return this.source.icao;
		}
	}

	get icaoNoSpace() {
		if (this.source instanceof WayPoint) {
			return this.source.icaoNoSpace;
		}
		if (!this._icaoNoSpace) {
			if (this.icao) {
				this._icaoNoSpace = this.icao;
				while (this._icaoNoSpace.indexOf(' ') != -1) {
					this._icaoNoSpace = this._icaoNoSpace.replace(' ', '_');
				}
			}
		}
		if (this._icaoNoSpace) {
			return this._icaoNoSpace;
		}
	}

	set icao(v) {
		this._icao = v;
		this._icaoNoSpace = this._icao;
		while (this._icaoNoSpace.indexOf(' ') != -1) {
			this._icaoNoSpace.replace(' ', '_');
		}
	}

	get coordinates() {
		if (this._coordinates) {
			return this._coordinates;
		}
		if (this.source && this.source.coordinates) {
			return this.source.coordinates;
		}
	}

	set coordinates(v) {
		this._coordinates = v;
	}

	get bearing() {
		if (this._bearing) {
			return this._bearing;
		}
		if (this.source) {
			return this.source.bearing;
		}
	}

	set bearing(v) {
		this._bearing = v;
	}

	get distance() {
		if (this._distance) {
			return this._distance;
		}
		if (this.source) {
			return this.source.distance;
		}
	}

	set distance(v) {
		this._distance = v;
	}

	updateSource(callback = EmptyCallback.Boolean) {
		if (this.source) {
			let waypoint = [...FlightPlanManager.DEBUG_INSTANCE.getWaypoints(), ...FlightPlanManager.DEBUG_INSTANCE.getArrivalWaypoints(), ...FlightPlanManager.DEBUG_INSTANCE.getApproachWaypoints()].find(w => {
				return this.source === w || (w && w.icao === this.source.icao);
			});

			if (waypoint) {
				this.source.isInFlightPlan = true;
				callback(true);
			} else {
				callback(false);
			}
		} else {
			callback(false);
		}
	}

	imageFileName() {
		if (this.source) {
			return this.source.imageFileName();
		}
	}

	createDraw(map) {
		let fontSize = map.config.waypointLabelFontSize / map.overdrawFactor;
		let text = this.ident;
		let c = document.createElement('canvas');
		let ctx = c.getContext('2d');
		ctx.font = fontSize + 'px ' + map.config.waypointLabelFontFamily;
		this._textWidth = ctx.measureText(text).width;
		this._textHeight = fontSize * 0.675;
		let ident;
		let activeWaypoint = FlightPlanManager.DEBUG_INSTANCE.getActiveWaypoint(false, true);
		if (activeWaypoint) {
			ident = activeWaypoint.ident;
		}
		let isActiveWaypoint = this.source.ident === ident;
		this._image = document.createElementNS(Avionics.SVG.NS, 'image');
		this._image.id = this.id(map);
		this._image.classList.add(this.class() + '-icon');
		this._image.setAttribute('hasTextBox', 'true');
		this._image.setAttribute('width', '100%');
		this._image.setAttribute('height', '100%');
		this.updateSource((isInFlightPlan) => {
			this._refreshLabel(map, isActiveWaypoint, isInFlightPlan);
			if (!isActiveWaypoint) {
				this._image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', map.config.imagesDir + this.imageFileName());
			} else {
				this._image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', map.config.imagesDir + 'ICON_MAP_INTERSECTION_FLIGHTPLAN_ACTIVE.png');
			}
			this._lastIsActiveWaypoint = isActiveWaypoint;
			this._image.setAttribute('width', fastToFixed(map.config.waypointIconSize / map.overdrawFactor, 0));
			this._image.setAttribute('height', fastToFixed(map.config.waypointIconSize / map.overdrawFactor, 0));
		});
		return this._image;
	}

	_refreshLabel(map, isActiveWaypoint, isInFlightPlan) {
		let labelId = this.id(map) + '-text-' + map.index;
		let label = document.getElementById(labelId);
		if (label instanceof SVGForeignObjectElement) {
			this._label = label;
			this.needRepaint = true;
		}
		let fontSize = map.config.waypointLabelFontSize / map.overdrawFactor;
		let text = this.ident;
		let canvas;
		if (!this._label) {
			this._label = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
			this._label.id = labelId;
			this._label.setAttribute('width', (this._textWidth + map.config.waypointLabelBackgroundPaddingLeft / map.overdrawFactor + map.config.waypointLabelBackgroundPaddingRight / map.overdrawFactor).toFixed(0) + 'px');
			this._label.setAttribute('height', (this._textHeight + map.config.waypointLabelBackgroundPaddingTop / map.overdrawFactor + map.config.waypointLabelBackgroundPaddingBottom / map.overdrawFactor).toFixed(0) + 'px');
			canvas = document.createElement('canvas');
			canvas.setAttribute('width', (this._textWidth + map.config.waypointLabelBackgroundPaddingLeft / map.overdrawFactor + map.config.waypointLabelBackgroundPaddingRight / map.overdrawFactor).toFixed(0) + 'px');
			canvas.setAttribute('height', (this._textHeight + map.config.waypointLabelBackgroundPaddingTop / map.overdrawFactor + map.config.waypointLabelBackgroundPaddingBottom / map.overdrawFactor).toFixed(0) + 'px');
			this._label.appendChild(canvas);
			map.textLayer.appendChild(this._label);
		} else {
			canvas = this._label.querySelector('canvas');
		}
		if (!canvas) {
			return;
		}
		let context = canvas.getContext('2d');
		if (map.config.waypointLabelUseBackground) {
			context.fillStyle = 'black';
			context.fillRect(0, 0, this._textWidth + map.config.waypointLabelBackgroundPaddingLeft / map.overdrawFactor + map.config.waypointLabelBackgroundPaddingRight / map.overdrawFactor, this._textHeight + map.config.waypointLabelBackgroundPaddingTop / map.overdrawFactor + map.config.waypointLabelBackgroundPaddingBottom / map.overdrawFactor);
		}
		if (!isActiveWaypoint) {
			if (isInFlightPlan) {
				context.fillStyle = 'white';
			} else if (this.source instanceof IntersectionInfo) {
				context.fillStyle = map.config.intersectionLabelColor;
			} else if (this.source instanceof VORInfo) {
				context.fillStyle = map.config.vorLabelColor;
			} else if (this.source instanceof NDBInfo) {
				context.fillStyle = map.config.ndbLabelColor;
			} else if (this.source instanceof AirportInfo) {
				context.fillStyle = map.config.airportLabelColor;
			} else {
				context.fillStyle = map.config.waypointLabelColor;
			}
		} else {
			context.fillStyle = 'magenta';
		}
		context.font = fontSize + 'px ' + map.config.waypointLabelFontFamily;
		context.clearRect(0,0, 500,500)
		context.fillText(text, map.config.waypointLabelBackgroundPaddingLeft / map.overdrawFactor, this._textHeight + map.config.waypointLabelBackgroundPaddingTop / map.overdrawFactor);
	}

	updateDraw(map) {
		if (this.coordinates) {
			map.coordinatesToXYToRef(this.coordinates, this);
		} else if (isFinite(this.source.latitudeFP) && isFinite(this.source.longitudeFP)) {
			map.coordinatesToXYToRef(new LatLongAlt(this.source.latitudeFP, this.source.longitudeFP), this);
		} else {
			let pos = map.bearingDistanceToXY(this.bearing, this.distance);
			this.x = pos.x;
			this.y = pos.y;
		}

		let wp = FlightPlanManager.DEBUG_INSTANCE.getActiveWaypoint(false, true);
		let isActiveWaypoint = this.source === wp || (wp && wp.icao === this.source.icao);
		if (isActiveWaypoint != this._lastIsActiveWaypoint) {
			this.updateSource((isInFlighPlan) => {
				this._refreshLabel(map, isActiveWaypoint, isInFlighPlan);
				if (this._image) {
					if (!isActiveWaypoint) {
						this._image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', map.config.imagesDir + this.imageFileName());
					} else {
						this._image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', map.config.imagesDir + 'ICON_MAP_INTERSECTION_FLIGHTPLAN_ACTIVE.png');
					}
				}
				this._lastIsActiveWaypoint = isActiveWaypoint;
			});
		}
		if (isFinite(this.x) && isFinite(this.y)) {
			if (this._image && this._lastMinimize !== this.minimize) {
				if (this.minimize) {
					this._image.setAttribute('width', fastToFixed(map.config.waypointIconSize / map.overdrawFactor * 0.5, 0));
					this._image.setAttribute('height', fastToFixed(map.config.waypointIconSize / map.overdrawFactor * 0.5, 0));
				} else {
					this._image.setAttribute('width', fastToFixed(map.config.waypointIconSize / map.overdrawFactor, 0));
					this._image.setAttribute('height', fastToFixed(map.config.waypointIconSize / map.overdrawFactor, 0));
				}
				this._lastMinimize = this.minimize;
				this.needRepaint = true;
			}
			if (this.needRepaint || Math.abs(this._lastX - this.x) > 0.1 || Math.abs(this._lastY - this.y) > 0.1) {
				this._lastX = this.x;
				this._lastY = this.y;
				let x = (this.x - map.config.waypointIconSize / map.overdrawFactor * 0.5 * (this.minimize ? 0.5 : 1));
				let y = (this.y - map.config.waypointIconSize / map.overdrawFactor * 0.5 * (this.minimize ? 0.5 : 1));
				this.svgElement.setAttribute('x', x + '');
				this.svgElement.setAttribute('y', y + '');
				if (this.source instanceof AirportInfo) {
					let a = this.source.longestRunwayDirection;
					if (isNaN(a) && this.source.runways[0]) {
						a = this.source.runways[0].direction;
					}
					if (isFinite(a)) {
						this._alpha = a - 45;
					}
				}
				if (isFinite(this._alpha)) {
					this.svgElement.setAttribute('transform', 'rotate(' + this._alpha.toFixed(0) + ' ' + this.x.toFixed(0) + ' ' + this.y.toFixed(0) + ')');
				}
				if (!this._label) {
					let labelId = this.id(map) + '-text-' + map.index;
					let label = document.getElementById(labelId);
					if (label instanceof SVGForeignObjectElement) {
						let c = document.createElement('canvas');
						let ctx = c.getContext('2d');
						let fontSize = map.config.waypointLabelFontSize / map.overdrawFactor;
						let text = this.ident;
						ctx.font = fontSize + 'px ' + map.config.waypointLabelFontFamily;
						this._textWidth = ctx.measureText(text).width;
						this._textHeight = fontSize * 0.675;
						this._label = label;
						this.needRepaint = true;
					}
				}
				if (this._label) {
					if (!isFinite(this._textWidth)) {
						let c = document.createElement('canvas');
						let ctx = c.getContext('2d');
						let fontSize = map.config.waypointLabelFontSize / map.overdrawFactor;
						let text = this.ident;
						ctx.font = fontSize + 'px ' + map.config.waypointLabelFontFamily;
						this._textWidth = ctx.measureText(text).width;
					}
					if (!isFinite(this._textHeight)) {
						let fontSize = map.config.waypointLabelFontSize / map.overdrawFactor;
						this._textHeight = fontSize * 0.675;
					}
					let textX = (x + map.config.waypointIconSize / map.overdrawFactor * 0.5 - this._textWidth * 0.5 + map.config.waypointLabelDistanceX / map.overdrawFactor);
					let textY = y + map.config.waypointLabelDistance / map.overdrawFactor;
					this._label.setAttribute('x', textX + '');
					this._label.setAttribute('y', textY + '');
					this.needRepaint = false;
				} else {
					this.needRepaint = true;
				}
			}
		}
	}
}

//# sourceMappingURL=SvgWaypointElement.js.map