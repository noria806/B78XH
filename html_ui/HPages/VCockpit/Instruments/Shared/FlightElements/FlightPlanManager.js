class FlightPlanManager {
	constructor(_instrument) {
		this._waypoints = [[], []];
		this._approachWaypoints = [];
		this._departureWaypointSize = 0;
		this._arrivalWaypointSize = 0;
		this._activeWaypointIndex = 0;
		this._onFlightPlanUpdateCallbacks = [];
		this.decelPrevIndex = -1;
		this._lastDistanceToPreviousActiveWaypoint = 0;
		this._isGoingTowardPreviousActiveWaypoint = false;
		this._resetTimer = 0;
		this._updateTimer = 0;
		this._isRegistered = false;
		this._isRegisteredAndLoaded = false;
		this._currentFlightPlanIndex = 0;
		this._activeWaypointIdentHasChanged = false;
		this._timeLastSimVarCall = 0;
		this._gpsActiveWaypointIndexHasChanged = false;
		this._timeLastActiveWaypointIndexSimVarCall = 0;
		this._isLoadedApproachTimeLastSimVarCall = 0;
		this._isActiveApproachTimeLastSimVarCall = 0;
		this._approachActivated = false;
		FlightPlanManager.DEBUG_INSTANCE = this;
		this.instrument = _instrument;
		this.registerListener();
	}

	addHardCodedConstraints(wp) {
		return;
		let icao = wp.icao;
		if (icao.indexOf('D0') != -1) {
			wp.legAltitude1 = 500;
		} else if (icao.indexOf('BOANE') != -1) {
			wp.legAltitude1 = 11000;
			wp.speedConstraint = 250;
		} else if (icao.indexOf('NEHOS') != -1) {
			wp.legAltitude1 = 8000;
			wp.speedConstraint = 230;
		} else if (icao.indexOf('GRIFY') != -1) {
			wp.legAltitude1 = 6000;
			wp.speedConstraint = 210;
		} else if (icao.indexOf('WK1KSEAHELZR') != -1) {
			wp.legAltitude1 = 4000;
		} else if (icao.indexOf('WK1KSEAKARFO') != -1) {
			wp.legAltitude1 = 3200;
		} else if (icao.indexOf('WK1KSEADGLAS') != -1) {
			wp.legAltitude1 = 1900;
		}
	}

	update(_deltaTime) {
		if (this._resetTimer > 0) {
			this._resetTimer -= _deltaTime;
			if (this._resetTimer <= 0) {
				this._resetTimer = 0;
				this._activeWaypointIdentHasChanged = false;
				this._gpsActiveWaypointIndexHasChanged = false;
			}
		}
		this._updateTimer += _deltaTime;
		if (this._updateTimer >= 1000) {
			this._updateTimer = 0;
			let prevWaypoint = this.getPreviousActiveWaypoint();
			if (prevWaypoint) {
				let planeCoordinates = new LatLong(SimVar.GetSimVarValue('PLANE LATITUDE', 'degree latitude'), SimVar.GetSimVarValue('PLANE LONGITUDE', 'degree longitude'));
				if (isFinite(planeCoordinates.lat) && isFinite(planeCoordinates.long)) {
					let dist = Avionics.Utils.computeGreatCircleDistance(planeCoordinates, prevWaypoint.infos.coordinates);
					if (isFinite(dist)) {
						if (dist < this._lastDistanceToPreviousActiveWaypoint && dist > 2) {
							this._isGoingTowardPreviousActiveWaypoint = true;
						} else {
							this._isGoingTowardPreviousActiveWaypoint = false;
						}
						this._lastDistanceToPreviousActiveWaypoint = dist;
						if ((this._activeWaypointIdentHasChanged || this._gpsActiveWaypointIndexHasChanged) && this._resetTimer <= 0) {
							this._resetTimer = 3000;
						}
						return;
					}
				}
			}
			if ((this._activeWaypointIdentHasChanged || this._gpsActiveWaypointIndexHasChanged) && this._resetTimer <= 0) {
				this._resetTimer = 3000;
			}
			this._isGoingTowardPreviousActiveWaypoint = false;
		}
	}

	onCurrentGameFlightLoaded(_callback) {
		if (this._isRegisteredAndLoaded) {
			_callback();
			return;
		}
		this._onCurrentGameFlightLoaded = _callback;
	}

	registerListener() {
		if (this._isRegistered) {
			return;
		}
		let nbWp = SimVar.GetSimVarValue('GPS FLIGHT PLAN WP COUNT', 'number');
		SimVar.SetSimVarValue('L:Glasscockpits_FPLHaveOrigin', 'boolean', (nbWp > 0 ? 1 : 0));
		SimVar.SetSimVarValue('L:Glasscockpits_FPLHaveDestination', 'boolean', (nbWp > 1 ? 1 : 0));
		this._isRegistered = true;
		RegisterViewListener('JS_LISTENER_FLIGHTPLAN');
		setTimeout(() => {
			Coherent.call('LOAD_CURRENT_GAME_FLIGHT');
			Coherent.call('LOAD_CURRENT_ATC_FLIGHTPLAN');
			setTimeout(() => {
				this._isRegisteredAndLoaded = true;
				if (this._onCurrentGameFlightLoaded) {
					this._onCurrentGameFlightLoaded();
				}
			}, 200);
		}, 200);
	}

	hasFlightPlan() {
		if (this.getWaypointsCount() > 0)
			return true;
		return false;
	}

	_loadWaypoints(data, currentWaypoints, callback) {
		let waypoints = [];
		let todo = data.length;
		let done = 0;
		let activeWaypointIndex = this.getActiveWaypointIndex(false, true);
		let isApproachActive = this.isActiveApproach(false);
		let timenow = SimVar.GetGlobalVarValue('ZULU TIME', 'seconds');
		for (let i = 0; i < data.length; i++) {
			let waypointData = data[i];
			let ii = i;
			let icao = waypointData.icao;
			if (waypointData.icao[0] === ' ' || waypointData.icao[0] == 'U' || waypointData.icao[0] == 'R') {
				if (waypointData.icao[0] === ' ') {
					icao = icao.replace(' ', 'U');
				}
				icao += '_' + ii;
				if (this.getApproachTransitionIndex() >= 0) {
					icao += this.getApproachTransitionIndex().toFixed(0);
				}
				if (this.getApproachIndex() >= 0) {
					icao += this.getApproachIndex().toFixed(0);
				}
			}
			if (currentWaypoints[ii] &&
				currentWaypoints[ii].infos &&
				currentWaypoints[ii].infos.icao === icao) {
				let v = currentWaypoints[ii];
				waypoints[ii] = v;
				v.bearingInFP = isFinite(waypointData.heading) ? waypointData.heading : 0;
				v.distanceInFP = waypointData.distance;
				v.altitudeinFP = waypointData.lla.alt * 3.2808;
				v.altitudeModeinFP = waypointData.altitudeMode;
				v.magvar = waypointData.magvar;
				if (i != data.length - 1 || !this._approachWaypoints) {
					v.estimatedTimeOfArrivalFP = waypointData.estimatedTimeOfArrival;
					if (!isApproachActive) {
						if (this.getIsDirectTo() && this.getDirectToTarget().icao === v.icao) {
							let d = this.getDistanceToDirectToTarget();
							let gs = Simplane.getGroundSpeed();
							if (gs < 100) {
								gs = 100;
							}
							v.estimatedTimeOfArrivalFP = timenow + d / gs * 3600;
							v.estimatedTimeOfArrivalFP = v.estimatedTimeOfArrivalFP % 86400;
						} else if (ii < activeWaypointIndex) {
							v.estimatedTimeOfArrivalFP = timenow;
						} else if (ii === activeWaypointIndex) {
							let d = this.getDistanceToActiveWaypoint();
							let gs = Simplane.getGroundSpeed();
							if (gs < 100) {
								gs = 100;
							}
							v.estimatedTimeOfArrivalFP = timenow + d / gs * 3600;
							v.estimatedTimeOfArrivalFP = v.estimatedTimeOfArrivalFP % 86400;
						} else {
							let vPrev = currentWaypoints[ii - 1];
							if (vPrev) {
								v.estimatedTimeOfArrivalFP = vPrev.estimatedTimeOfArrivalFP + v.estimatedTimeEnRouteFP;
								v.estimatedTimeOfArrivalFP = v.estimatedTimeOfArrivalFP % 86400;
							}
						}
					}
					v.estimatedTimeEnRouteFP = waypointData.estimatedTimeEnRoute;
					v.cumulativeEstimatedTimeEnRouteFP = waypointData.cumulativeEstimatedTimeEnRoute;
					v.cumulativeDistanceInFP = waypointData.cumulativeDistance;
				}
				v.infos.totalDistInFP = waypointData.cumulativeDistance;
				v.infos.totalTimeInFP = waypointData.estimatedTimeEnRoute;
				v.infos.airwayIdentInFP = waypointData.airwayIdent;
				v.speedConstraint = waypointData.speedConstraint;
				v.transitionLLas = waypointData.transitionLLas;
				if (v.speedConstraint > 0) {
				}
				if (v.speedConstraint > 400) {
					v.speedConstraint = -1;
				}
				if ((ii > 0 && ii <= this.getDepartureWaypointsCount()) && (v.altitudeinFP >= 1000)) {
					v.legAltitudeDescription = 2;
					v.legAltitude1 = v.altitudeinFP;
				} else if ((ii < (data.length - 1) && ii >= (data.length - 1 - this.getArrivalWaypointsCount())) && (v.altitudeinFP >= 1000)) {
					v.legAltitudeDescription = 2;
					v.legAltitude1 = v.altitudeinFP;
				} else if (ii > 0 && ii < data.length - 1 && (v.altitudeinFP >= 1000)) {
					v.legAltitudeDescription = 1;
					v.legAltitude1 = v.altitudeinFP;
				} else if (currentWaypoints === this._approachWaypoints) {
					v.legAltitudeDescription = 1;
					v.legAltitude1 = v.altitudeinFP;
				}
				this.addHardCodedConstraints(v);
				done++;
			} else {
				if (waypointData.icao[0] === ' ' || waypointData.icao[0] == 'U' || waypointData.icao[0] == 'R' || waypointData.ident === 'CUSTD' || waypointData.ident === 'CUSTA') {
					let wp = new WayPoint(this.instrument);
					wp.infos = new IntersectionInfo(this.instrument);
					wp.icao = icao;
					wp.infos.icao = wp.icao;
					wp.ident = waypointData.ident;
					wp.infos.ident = waypointData.ident;
					wp.infos.coordinates = new LatLongAlt(waypointData.lla);
					wp.latitudeFP = waypointData.lla.lat;
					wp.longitudeFP = waypointData.lla.long;
					wp.altitudeinFP = waypointData.lla.alt * 3.2808;
					wp.altitudeModeinFP = waypointData.altitudeMode;
					wp.bearingInFP = isFinite(waypointData.heading) ? waypointData.heading : 0;
					wp.distanceInFP = waypointData.distance;
					wp.cumulativeDistanceInFP = waypointData.cumulativeDistance;
					wp.infos.totalDistInFP = waypointData.cumulativeDistance;
					wp.estimatedTimeOfArrivalFP = waypointData.estimatedTimeOfArrival;
					wp.estimatedTimeEnRouteFP = waypointData.estimatedTimeEnRoute;
					wp.cumulativeEstimatedTimeEnRouteFP = waypointData.cumulativeEstimatedTimeEnRoute;
					wp.infos.totalTimeInFP = waypointData.estimatedTimeEnRoute;
					wp.infos.airwayIdentInFP = waypointData.airwayIdent;
					wp.speedConstraint = waypointData.speedConstraint;
					wp.transitionLLas = waypointData.transitionLLas;
					wp.magvar = waypointData.magvar;
					if (wp.speedConstraint > 0) {
					}
					if (wp.speedConstraint > 400) {
						wp.speedConstraint = -1;
					}
					if ((ii > 0 && ii <= this.getDepartureWaypointsCount()) && (wp.altitudeinFP >= 1000)) {
						wp.legAltitudeDescription = 2;
						wp.legAltitude1 = wp.altitudeinFP;
					} else if ((ii < (data.length - 1) && ii >= (data.length - 1 - this.getArrivalWaypointsCount())) && (wp.altitudeinFP >= 1000)) {
						wp.legAltitudeDescription = 2;
						wp.legAltitude1 = wp.altitudeinFP;
					} else if (ii > 0 && ii < data.length - 1 && (wp.altitudeinFP >= 1000)) {
						wp.legAltitudeDescription = 1;
						wp.legAltitude1 = wp.altitudeinFP;
					}
					this.addHardCodedConstraints(wp);
					waypoints[ii] = wp;
					done++;
				} else {
					this.instrument.facilityLoader.getFacility(waypointData.icao).then((v) => {
						done++;
						waypoints[ii] = v;
						if (v) {
							v.infos.icao = v.icao;
							v.infos.ident = v.ident;
							v.infos.UpdateAirways();
							const matchingCurrentWaypoint = currentWaypoints.find(wp => wp.infos.icao === v.infos.icao);
							if (matchingCurrentWaypoint) {
								v.infos.airwayIn = matchingCurrentWaypoint.infos.airwayIn;
								v.infos.airwayOut = matchingCurrentWaypoint.infos.airwayOut;
							}
							v.latitudeFP = waypointData.lla.lat;
							v.longitudeFP = waypointData.lla.long;
							v.altitudeinFP = waypointData.lla.alt * 3.2808;
							v.altitudeModeinFP = waypointData.altitudeMode;
							v.bearingInFP = isFinite(waypointData.heading) ? waypointData.heading : 0;
							v.distanceInFP = waypointData.distance;
							v.cumulativeDistanceInFP = waypointData.cumulativeDistance;
							v.infos.totalDistInFP = waypointData.cumulativeDistance;
							v.estimatedTimeOfArrivalFP = waypointData.estimatedTimeOfArrival;
							v.estimatedTimeEnRouteFP = waypointData.estimatedTimeEnRoute;
							v.cumulativeEstimatedTimeEnRouteFP = waypointData.cumulativeEstimatedTimeEnRoute;
							v.infos.totalTimeInFP = waypointData.estimatedTimeEnRoute;
							v.infos.airwayIdentInFP = waypointData.airwayIdent;
							v.speedConstraint = waypointData.speedConstraint;
							v.transitionLLas = waypointData.transitionLLas;
							v.magvar = waypointData.magvar;
							if (v.speedConstraint > 0) {
							}
							if (v.speedConstraint > 400) {
								v.speedConstraint = -1;
							}
							if ((ii > 0 && ii <= this.getDepartureWaypointsCount()) && (v.altitudeinFP >= 1000)) {
								v.legAltitudeDescription = 2;
								v.legAltitude1 = v.altitudeinFP;
							} else if ((ii < (data.length - 1) && ii >= (data.length - 1 - this.getArrivalWaypointsCount())) && (v.altitudeinFP >= 1000)) {
								v.legAltitudeDescription = 2;
								v.legAltitude1 = v.altitudeinFP;
							} else if (ii > 0 && ii < data.length - 1 && (v.altitudeinFP >= 1000)) {
								v.legAltitudeDescription = 1;
								v.legAltitude1 = v.altitudeinFP;
							}
							this.addHardCodedConstraints(v);
						}
					});
				}
			}
		}
		let destination = this.getDestination();
		if (destination) {
			if (SimVar.GetSimVarValue('L:FLIGHTPLAN_USE_DECEL_WAYPOINT', 'number') === 1) {
				setTimeout(() => {
					if (!this.decelWaypoint) {
						this.decelWaypoint = new WayPoint(this.instrument);
						this.decelWaypoint.infos = new IntersectionInfo(this.instrument);
					}
					this.decelWaypoint.icao = '';
					this.decelWaypoint.infos.icao = this.decelWaypoint.icao;
					this.decelWaypoint.ident = 'DECEL';
					this.decelWaypoint.infos.ident = this.decelWaypoint.ident;
					let r = this.getCoordinatesAtNMFromDestinationAlongFlightPlan(32);
					if (r) {
						let decelCoordinates = r.lla;
						this.decelWaypoint.infos.coordinates = new LatLongAlt(decelCoordinates.lat, decelCoordinates.long);
						this.decelWaypoint.latitudeFP = this.decelWaypoint.infos.coordinates.lat;
						this.decelWaypoint.longitudeFP = this.decelWaypoint.infos.coordinates.long;
						this.decelWaypoint.altitudeinFP = this.decelWaypoint.infos.coordinates.alt;
						let destination = this.getDestination();
						if (destination) {
							this.decelWaypoint.cumulativeDistanceInFP = destination.cumulativeDistanceInFP - 32;
						}
						this.decelPrevIndex = r.prevIndex;
						let prevWaypoint = this.getWaypoint(r.prevIndex, undefined, true);
						if (prevWaypoint) {
							this.decelWaypoint.legAltitude1 = prevWaypoint.legAltitude1;
							this.decelWaypoint.legAltitudeDescription = prevWaypoint.legAltitudeDescription;
							this.decelWaypoint.estimatedTimeOfArrivalFP = prevWaypoint.estimatedTimeOfArrivalFP;
						}
					}
				}, 300);
			}
		}
		let delayCallback = () => {
			if (done === todo) {
				if (callback) {
					callback(waypoints);
				}
			} else {
				this.instrument.requestCall(delayCallback);
			}
		};
		delayCallback();
	}

	updateWaypointIndex() {
		Coherent.call('GET_ACTIVE_WAYPOINT_INDEX').then((waypointIndex) => {
			this._activeWaypointIndex = waypointIndex;
		});
	}

	updateFlightPlan(callback = () => {
	}, log = false) {
		let t0 = performance.now();
		Coherent.call('GET_FLIGHTPLAN').then((flightPlanData) => {
			let t1 = performance.now();
			if (log) {
			}
			let index = flightPlanData.flightPlanIndex;
			this._cruisingAltitude = flightPlanData.cruisingAltitude;
			this._activeWaypointIndex = flightPlanData.activeWaypointIndex;
			this._departureWaypointSize = Math.max(0, flightPlanData.departureWaypointsSize);
			this._runwayIndex = flightPlanData.originRunwayIndex;
			this._departureRunwayIndex = flightPlanData.departureRunwayIndex;
			this._departureProcIndex = flightPlanData.departureProcIndex;
			this._departureEnRouteTransitionIndex = flightPlanData.departureEnRouteTransitionIndex;
			this._departureDiscontinuity = flightPlanData.departureDiscontinuity;
			this._arrivalWaypointSize = Math.max(0, flightPlanData.arrivalWaypointsSize);
			this._arrivalProcIndex = flightPlanData.arrivalProcIndex;
			this._arrivalTransitionIndex = flightPlanData.arrivalEnRouteTransitionIndex;
			this._arrivalDiscontinuity = flightPlanData.arrivalDiscontinuity;
			this._approachIndex = flightPlanData.approachIndex;
			this._approachTransitionIndex = flightPlanData.approachTransitionIndex;
			this._lastIndexBeforeApproach = flightPlanData.lastIndexBeforeApproach;
			this._isDirectTo = flightPlanData.isDirectTo;
			if (!this._directToTarget) {
				this._directToTarget = new WayPoint(this.instrument);
				this._directToTarget.infos = new IntersectionInfo(this.instrument);
			}
			this._directToTarget.icao = flightPlanData.directToTarget.icao;
			this._directToTarget.infos.icao = this._directToTarget.icao;
			this._directToTarget.ident = flightPlanData.directToTarget.ident;
			if (!this._directToTarget.ident) {
				this._directToTarget.ident = this._directToTarget.icao.substr(7);
			}
			this._directToTarget.infos.ident = this._directToTarget.ident;
			this._directToTarget.infos.coordinates = new LatLongAlt(flightPlanData.directToTarget.lla);
			this._directToOrigin = new LatLongAlt(flightPlanData.directToOrigin);
			if (!this._waypoints[index]) {
				this._waypoints[index] = [];
			}
			this._loadWaypoints(flightPlanData.waypoints, this._waypoints[index], (wps) => {
				this._waypoints[index] = wps;
				let t2 = performance.now();
				if (log) {
				}
				if (callback) {
					callback();
				}
			});
		});
	}

	updateCurrentApproach(callback = () => {
	}, log = false) {
		let t0 = performance.now();
		Coherent.call('GET_APPROACH_FLIGHTPLAN').then((flightPlanData) => {
			this._loadWaypoints(flightPlanData.waypoints, this._approachWaypoints, (wps) => {
				this._approachWaypoints = wps;
				let previousWaypoint = this.getWaypoint(this.getWaypointsCount() - 2);
				let activeWaypoint = this.getActiveWaypoint(false, true);
				for (let i = 0; i < this._approachWaypoints.length; i++) {
					let waypoint = this._approachWaypoints[i];
					if (waypoint) {
						if (previousWaypoint && waypoint.infos) {
							waypoint.distanceInFP = Avionics.Utils.computeGreatCircleDistance(previousWaypoint.infos.coordinates, waypoint.infos.coordinates);
							waypoint.estimatedTimeEnRouteFP = waypoint.distanceInFP / 200 * 3600;
							waypoint.cumulativeEstimatedTimeEnRouteFP = waypoint.estimatedTimeEnRouteFP + previousWaypoint.cumulativeEstimatedTimeEnRouteFP;
							if (this.getIsDirectTo() && this.getDirectToTarget().icao === waypoint.icao) {
								let d = this.getDistanceToDirectToTarget();
								let gs = Simplane.getGroundSpeed();
								if (gs < 100) {
									gs = 100;
								}
								let timenow = SimVar.GetGlobalVarValue('ZULU TIME', 'seconds');
								waypoint.estimatedTimeOfArrivalFP = timenow + d / gs * 3600;
								waypoint.estimatedTimeOfArrivalFP = waypoint.estimatedTimeOfArrivalFP % 86400;
							} else if (activeWaypoint && activeWaypoint.icao === waypoint.icao) {
								let d = this.getDistanceToActiveWaypoint();
								let gs = Simplane.getGroundSpeed();
								if (gs < 100) {
									gs = 100;
								}
								let timenow = SimVar.GetGlobalVarValue('ZULU TIME', 'seconds');
								waypoint.estimatedTimeOfArrivalFP = timenow + d / gs * 3600;
								waypoint.estimatedTimeOfArrivalFP = waypoint.estimatedTimeOfArrivalFP % 86400;
							} else {
								waypoint.estimatedTimeOfArrivalFP = waypoint.estimatedTimeEnRouteFP + previousWaypoint.estimatedTimeOfArrivalFP;
							}
							waypoint.cumulativeDistanceInFP = previousWaypoint.cumulativeDistanceInFP + waypoint.distanceInFP;
							if (i === this._approachWaypoints.length - 1) {
								let destination = this.getDestination();
								if (destination) {
									destination.estimatedTimeOfArrivalFP = waypoint.estimatedTimeOfArrivalFP;
									destination.estimatedTimeEnRouteFP = waypoint.estimatedTimeEnRouteFP;
									destination.cumulativeEstimatedTimeEnRouteFP = waypoint.cumulativeEstimatedTimeEnRouteFP;
									destination.cumulativeDistanceInFP = waypoint.cumulativeDistanceInFP;
								}
							}
							waypoint.bearingInFP = Avionics.Utils.computeGreatCircleHeading(previousWaypoint.infos.coordinates, waypoint.infos.coordinates);
						}
						this.addHardCodedConstraints(waypoint);
						previousWaypoint = waypoint;
					}
				}
			});
		});
		Coherent.call('GET_CURRENT_APPROACH').then((approachData) => {
			let t1 = performance.now();
			if (log) {
				console.log('Approach Data loaded from FlightPlanManager in ' + (t1 - t0).toFixed(2) + ' ms.');
				console.log(approachData);
			}
			if (!this._approach) {
				this._approach = new Approach();
			}
			this._approach.name = approachData.name;
			this._approach.runway = approachData.name.split(' ')[1];
			let destination = this.getDestination();
			if (destination && destination.infos instanceof AirportInfo) {
				let airportInfo = destination.infos;
				let firstApproach = airportInfo.approaches[0];
				if (firstApproach) {
					this._approach.vorFrequency = firstApproach.vorFrequency;
					this._approach.vorIdent = firstApproach.vorIdent;
				}
			}
			this._approach.transitions = [];
			for (let i = 0; i < approachData.transitions.length; i++) {
				let transitionData = approachData.transitions[i];
				let transition = new Transition();
				transition.name = transitionData.name;
				let previousWaypoint = this.getWaypoint(this.getWaypointsCount() - 2);
				for (let j = 1; j < transitionData.waypoints.length; j++) {
					let waypointData = transitionData.waypoints[j];
					let waypoint = new WayPoint(this.instrument);
					waypoint.infos = new IntersectionInfo(this.instrument);
					waypoint.icao = waypointData.icao;
					waypoint.infos.icao = waypoint.icao;
					waypoint.ident = waypointData.ident;
					if (!waypoint.ident) {
						waypoint.ident = waypoint.icao.substr(7);
					}
					waypoint.infos.ident = waypoint.ident;
					waypoint.infos.coordinates = new LatLongAlt(waypointData.lla);
					waypoint.latitudeFP = waypointData.lla.lat;
					waypoint.longitudeFP = waypointData.lla.lon;
					waypoint.altitudeinFP = waypointData.lla.alt * 3.2808;
					waypoint.altitudeModeinFP = waypointData.altitudeMode;
					waypoint.transitionLLas = waypointData.transitionLLas;
					let altitudeConstraintInFeet = waypoint.altitudeinFP;
					if (altitudeConstraintInFeet >= 1000) {
						waypoint.legAltitudeDescription = 1;
						waypoint.legAltitude1 = altitudeConstraintInFeet;
					}
					waypoint.speedConstraint = waypointData.speedConstraint;
					if (waypoint.speedConstraint > 0) {
					}
					if (waypoint.speedConstraint > 400) {
						waypoint.speedConstraint = -1;
					}
					if (previousWaypoint) {
						waypoint.distanceInFP = Avionics.Utils.computeGreatCircleDistance(previousWaypoint.infos.coordinates, waypoint.infos.coordinates);
						waypoint.cumulativeDistanceInFP = previousWaypoint.cumulativeDistanceInFP + waypoint.distanceInFP;
						waypoint.bearingInFP = Avionics.Utils.computeGreatCircleHeading(previousWaypoint.infos.coordinates, waypoint.infos.coordinates);
					}
					transition.waypoints.push(waypoint);
					previousWaypoint = waypoint;
				}
				transition.waypoints.push(this._waypoints[this._currentFlightPlanIndex][this._waypoints[this._currentFlightPlanIndex].length - 1]);
				this._approach.transitions.push(transition);
			}
			if (log) {
				console.log('FlightPlanManager now');
				console.log(this);
			}
			callback();
		});
	}

	get cruisingAltitude() {
		return this._cruisingAltitude;
	}

	getCurrentFlightPlanIndex() {
		return this._currentFlightPlanIndex;
	}

	setCurrentFlightPlanIndex(index, callback = EmptyCallback.Boolean) {
		Coherent.call('SET_CURRENT_FLIGHTPLAN_INDEX', index).then(() => {
			let attempts = 0;
			let checkTrueFlightPlanIndex = () => {
				Coherent.call('GET_CURRENT_FLIGHTPLAN_INDEX').then((value) => {
					attempts++;
					if (value === index) {
						console.log('setCurrentFlightPlanIndex : Values matching, return after ' + attempts + ' attempts');
						this._currentFlightPlanIndex = index;
						this.updateFlightPlan(() => {
							callback(true);
						});
						return;
					} else {
						if (attempts < 60) {
							console.log('setCurrentFlightPlanIndex : Values mistmatch, retrying');
							this.instrument.requestCall(checkTrueFlightPlanIndex);
							return;
						} else {
							console.log('setCurrentFlightPlanIndex : Values mistmatched too long, aborting');
							return callback(false);
						}
					}
				});
			};
			checkTrueFlightPlanIndex();
		});
	}

	createNewFlightPlan(callback = EmptyCallback.Void) {
		Coherent.call('CREATE_NEW_FLIGHTPLAN').then(() => {
			this.instrument.requestCall(callback);
		});
	}

	copyCurrentFlightPlanInto(index, callback = EmptyCallback.Void) {
		Coherent.call('COPY_CURRENT_FLIGHTPLAN_TO', index).then(() => {
			this.instrument.requestCall(callback);
		});
	}

	copyFlightPlanIntoCurrent(index, callback = EmptyCallback.Void) {
		Coherent.call('COPY_FLIGHTPLAN_TO_CURRENT', index).then(() => {
			this.instrument.requestCall(callback);
		});
	}

	clearFlightPlan(callback = EmptyCallback.Void) {
		Coherent.call('CLEAR_CURRENT_FLIGHT_PLAN').then(() => {
			this.updateFlightPlan(() => {
				this.updateCurrentApproach(() => {
					this.instrument.requestCall(callback);
				});
			});
		});
	}

	getOrigin(_addedAsOriginOnly = false) {
		if (this._waypoints.length > 0 && (this._isDirectTo || !_addedAsOriginOnly || SimVar.GetSimVarValue('L:Glasscockpits_FPLHaveOrigin', 'boolean'))) {
			return this._waypoints[this._currentFlightPlanIndex][0];
		} else {
			return null;
		}
	}

	setOrigin(icao, callback = () => {
	}, useLocalVars = false) {
		Coherent.call('SET_ORIGIN', icao, useLocalVars && !SimVar.GetSimVarValue('L:Glasscockpits_FPLHaveOrigin', 'boolean')).then(() => {
			if (useLocalVars) {
				SimVar.SetSimVarValue('L:Glasscockpits_FPLHaveOrigin', 'boolean', 1);
			}
			this.updateFlightPlan(callback);
		});
	}

	getActiveWaypointIndex(forceSimVarCall = false, useCorrection = false) {
		if (useCorrection && this._isGoingTowardPreviousActiveWaypoint) {
			return this.getActiveWaypointIndex(forceSimVarCall, false) - 1;
		}
		let ident = this.getActiveWaypointIdent(forceSimVarCall);
		if (this.isActiveApproach()) {
			let waypointIndex = this.getApproachWaypoints().findIndex(w => {
				return w && w.ident === ident;
			});
			return waypointIndex;
		}
		let waypointIndex = this.getWaypoints().findIndex(w => {
			return w && w.ident === ident;
		});
		if (waypointIndex === -1) {
			waypointIndex = this.getApproachWaypoints().findIndex(w => {
				return w && w.ident === ident;
			});
			if (!this._approachActivated) {
				return this.getWaypointsCount() - 1;
			}
		}
		if (useCorrection && (this._activeWaypointIdentHasChanged || this._gpsActiveWaypointIndexHasChanged)) {
			return waypointIndex - 1;
		}
		return waypointIndex;
	}

	setActiveWaypointIndex(index, callback = EmptyCallback.Void) {
		Coherent.call('SET_ACTIVE_WAYPOINT_INDEX', index).then(callback);
	}

	recomputeActiveWaypointIndex(callback = EmptyCallback.Void) {
		Coherent.call('RECOMPUTE_ACTIVE_WAYPOINT_INDEX').then(callback);
	}

	getPreviousActiveWaypoint(forceSimVarCall = false) {
		let ident = this.getActiveWaypointIdent(forceSimVarCall);
		if (this.isActiveApproach()) {
			let waypointIndex = this.getApproachWaypoints().findIndex(w => {
				return (w && w.ident === ident);
			});
			return this.getApproachWaypoints()[waypointIndex - 1];
		}
		let waypointIndex = this.getWaypoints().findIndex(w => {
			return (w && w.ident === ident);
		});
		if (waypointIndex === -1) {
			waypointIndex = this.getApproachWaypoints().findIndex(w => {
				return (w && w.ident === ident);
			});
		}
		return this.getWaypoints()[waypointIndex - 1];
	}

	getActiveWaypointIdent(forceSimVarCall = false) {
		let doSimVarCall = false;
		let t = 0;
		if (forceSimVarCall || this._activeWaypointIdent === undefined) {
			doSimVarCall = true;
		} else {
			t = performance.now();
			if (t - this._timeLastSimVarCall > 1000) {
				doSimVarCall = true;
			}
		}
		if (doSimVarCall) {
			let activeWaypointIdent = SimVar.GetSimVarValue('GPS WP NEXT ID', 'string');
			if (this._activeWaypointIdent != activeWaypointIdent) {
				this._activeWaypointIdentHasChanged = true;
				this._activeWaypointIdent = activeWaypointIdent;
			}
			this._timeLastSimVarCall = t;
		}
		return this._activeWaypointIdent;
	}

	getGPSActiveWaypointIndex(forceSimVarCall = false) {
		let doSimVarCall = false;
		let t = 0;
		if (forceSimVarCall || this._gpsActiveWaypointIndex === undefined) {
			doSimVarCall = true;
		} else {
			t = performance.now();
			if (t - this._timeLastActiveWaypointIndexSimVarCall > 1000) {
				doSimVarCall = true;
			}
		}
		if (doSimVarCall) {
			let gpsActiveWaypointIndex = SimVar.GetSimVarValue('C:fs9gps:FlightPlanActiveWaypoint', 'number');
			if (this._gpsActiveWaypointIndex != gpsActiveWaypointIndex) {
				this._gpsActiveWaypointIndexHasChanged = true;
				this._gpsActiveWaypointIndex = gpsActiveWaypointIndex;
			}
			this._timeLastActiveWaypointIndexSimVarCall = t;
		}
		return this._gpsActiveWaypointIndex;
	}

	getActiveWaypoint(forceSimVarCall = false, useCorrection = false) {
		if (this.getIsDirectTo()) {
			return this.getDirectToTarget();
		}
		if (useCorrection && this._isGoingTowardPreviousActiveWaypoint) {
			return this.getPreviousActiveWaypoint(forceSimVarCall);
		}
		if (!this.isActiveApproach()) {
			let index = this.getActiveWaypointIndex(forceSimVarCall);
			let waypoint = this.getWaypoints()[index];
			if (waypoint) {
				if (useCorrection && (this._activeWaypointIdentHasChanged || this._gpsActiveWaypointIndexHasChanged)) {
					return this.getPreviousActiveWaypoint(forceSimVarCall);
				}
				return waypoint;
			}
		}
		let ident = this.getActiveWaypointIdent(forceSimVarCall);
		if (this.isActiveApproach()) {
			let waypoint = this.getApproachWaypoints().find(w => {
				return (w && w.ident === ident);
			});
			return waypoint;
		}
		let waypoint = this.getWaypoints().find(w => {
			return (w && w.ident === ident);
		});
		if (!waypoint) {
			waypoint = this.getApproachWaypoints().find(w => {
				return (w && w.ident === ident);
			});
		}
		if (!waypoint && this._directToTarget && ident != '' && ident === this._directToTarget.ident) {
			waypoint = this._directToTarget;
		}
		if (useCorrection && (this._activeWaypointIdentHasChanged || this._gpsActiveWaypointIndexHasChanged)) {
			return this.getPreviousActiveWaypoint(forceSimVarCall);
		}
		return waypoint;
	}

	getNextActiveWaypoint(forceSimVarCall = false) {
		let ident = this.getActiveWaypointIdent(forceSimVarCall);
		if (this.isActiveApproach()) {
			let waypointIndex = this.getApproachWaypoints().findIndex(w => {
				return (w && w.ident === ident);
			});
			return this.getApproachWaypoints()[waypointIndex + 1];
		}
		let waypointIndex = this.getWaypoints().findIndex(w => {
			return (w && w.ident === ident);
		});
		if (waypointIndex === -1) {
			waypointIndex = this.getApproachWaypoints().findIndex(w => {
				return (w && w.ident === ident);
			});
		}
		return this.getWaypoints()[waypointIndex + 1];
	}

	getDistanceToActiveWaypoint() {
		let lat = SimVar.GetSimVarValue('PLANE LATITUDE', 'degree latitude');
		let long = SimVar.GetSimVarValue('PLANE LONGITUDE', 'degree longitude');
		let ll = new LatLong(lat, long);
		let waypoint = this.getActiveWaypoint();
		if (waypoint && waypoint.infos) {
			return Avionics.Utils.computeDistance(ll, waypoint.infos.coordinates);
		}
		return 0;
	}

	getDistanceToDirectToTarget() {
		let lat = SimVar.GetSimVarValue('PLANE LATITUDE', 'degree latitude');
		let long = SimVar.GetSimVarValue('PLANE LONGITUDE', 'degree longitude');
		let ll = new LatLong(lat, long);
		let waypoint = this.getDirectToTarget();
		if (waypoint && waypoint.infos) {
			return Avionics.Utils.computeDistance(ll, waypoint.infos.coordinates);
		}
		return 0;
	}

	getBearingToActiveWaypoint() {
		let lat = SimVar.GetSimVarValue('PLANE LATITUDE', 'degree latitude');
		let long = SimVar.GetSimVarValue('PLANE LONGITUDE', 'degree longitude');
		let ll = new LatLong(lat, long);
		let waypoint = this.getActiveWaypoint();
		if (waypoint && waypoint.infos) {
			return Avionics.Utils.computeGreatCircleHeading(ll, waypoint.infos.coordinates);
		}
		return 0;
	}

	getETEToActiveWaypoint() {
		let lat = SimVar.GetSimVarValue('PLANE LATITUDE', 'degree latitude');
		let long = SimVar.GetSimVarValue('PLANE LONGITUDE', 'degree longitude');
		let ll = new LatLong(lat, long);
		let waypoint = this.getActiveWaypoint();
		if (waypoint && waypoint.infos) {
			let dist = Avionics.Utils.computeDistance(ll, waypoint.infos.coordinates);
			let groundSpeed = SimVar.GetSimVarValue('GPS GROUND SPEED', 'knots');
			if (groundSpeed < 50) {
				groundSpeed = 50;
			}
			if (groundSpeed > 0.1) {
				return dist / groundSpeed * 3600;
			}
		}
		return 0;
	}

	getDestination(_addedAsDestinationOnly = false) {
		if (this._isDirectTo || (!_addedAsDestinationOnly && this._waypoints[this._currentFlightPlanIndex].length > 1) || (_addedAsDestinationOnly && SimVar.GetSimVarValue('L:Glasscockpits_FPLHaveDestination', 'boolean') && this._waypoints[this._currentFlightPlanIndex].length > 0)) {
			if (this._waypoints[this._currentFlightPlanIndex].length === 2 && this.getWaypoint(0).icao === this.getWaypoint(1).icao) {
				return undefined;
			}
			return this._waypoints[this._currentFlightPlanIndex][this._waypoints[this._currentFlightPlanIndex].length - 1];
		} else {
			return undefined;
		}
	}

	getDeparture() {
		let origin = this.getOrigin();
		if (origin) {
			let originInfos = origin.infos;
			if (originInfos instanceof AirportInfo) {
				return originInfos.departures[this._departureProcIndex];
			}
		}
	}

	getArrival() {
		let destination = this.getDestination();
		if (destination) {
			let destinationInfos = destination.infos;
			if (destinationInfos instanceof AirportInfo) {
				return destinationInfos.arrivals[this._arrivalProcIndex];
			}
		}
	}

	getAirportApproach() {
		let destination = this.getDestination();
		if (destination) {
			let destinationInfos = destination.infos;
			if (destinationInfos instanceof AirportInfo) {
				return destinationInfos.approaches[this._approachIndex];
			}
		}
	}

	getDepartureWaypoints() {
		let departureWaypoints = [];
		let origin = this.getOrigin();
		if (origin) {
			let originInfos = origin.infos;
			if (originInfos instanceof AirportInfo) {
				let departure = originInfos.departures[this._departureProcIndex];
				if (departure) {
					let runwayTransition = departure.runwayTransitions[0];
					if (departure.runwayTransitions.length > 0) {
						runwayTransition = departure.runwayTransitions[this._departureRunwayIndex];
					}
					if (runwayTransition && runwayTransition.legs) {
						for (let i = 0; i < runwayTransition.legs.length; i++) {
							let wp = new WayPoint(this.instrument);
							wp.icao = runwayTransition.legs[i].fixIcao;
							wp.ident = wp.icao.substr(7);
							departureWaypoints.push(wp);
						}
					}
					if (departure && departure.commonLegs) {
						for (let i = 0; i < departure.commonLegs.length; i++) {
							let wp = new WayPoint(this.instrument);
							wp.icao = departure.commonLegs[i].fixIcao;
							wp.ident = wp.icao.substr(7);
							departureWaypoints.push(wp);
						}
					}
					let enRouteTransition = departure.enRouteTransitions[0];
					if (departure.enRouteTransitions.length > 0) {
						enRouteTransition = departure.enRouteTransitions[this._departureRunwayIndex];
					}
					if (enRouteTransition && enRouteTransition.legs) {
						for (let i = 0; i < enRouteTransition.legs.length; i++) {
							let wp = new WayPoint(this.instrument);
							wp.icao = enRouteTransition.legs[i].fixIcao;
							wp.ident = wp.icao.substr(7);
							departureWaypoints.push(wp);
						}
					}
				}
			}
		}
		return departureWaypoints;
	}

	getDepartureWaypointsMap() {
		let departureWaypoints = [];
		for (let i = 1; i < this._departureWaypointSize + 1; i++) {
			departureWaypoints.push(this._waypoints[this._currentFlightPlanIndex][i]);
		}
		return departureWaypoints;
	}

	getEnRouteWaypoints(outFPIndex = null, useLocalVarForExtremity = false) {
		let enRouteWaypoints = [];
		for (let i = ((useLocalVarForExtremity && !SimVar.GetSimVarValue('L:Glasscockpits_FPLHaveOrigin', 'boolean') ? 0 : 1) + this._departureWaypointSize); i < this._waypoints[this._currentFlightPlanIndex].length - (useLocalVarForExtremity && !SimVar.GetSimVarValue("L:Glasscockpits_FPLHaveDestination", "boolean") ? 0 : 1) - this._arrivalWaypointSize; i++) {
			enRouteWaypoints.push(this._waypoints[this._currentFlightPlanIndex][i]);
			if (outFPIndex) {
				outFPIndex.push(i);
			}
		}
		return enRouteWaypoints;
	}

	getEnRouteWaypointsLastIndex() {
		return this.getDepartureWaypointsCount() + this.getEnRouteWaypoints().length;
	}

	getArrivalWaypoints() {
		let arrivalWaypoints = [];
		let destination = this.getDestination();
		if (destination) {
			let destinationInfos = destination.infos;
			if (destinationInfos instanceof AirportInfo) {
				let arrival = destinationInfos.arrivals[this._arrivalProcIndex];
				if (arrival) {
					let enRouteTransition = arrival.enRouteTransitions[0];
					if (arrival.enRouteTransitions.length > 0) {
					}
					if (enRouteTransition && enRouteTransition.legs) {
						for (let i = 0; i < enRouteTransition.legs.length; i++) {
							let wp = new WayPoint(this.instrument);
							wp.icao = enRouteTransition.legs[i].fixIcao;
							wp.ident = wp.icao.substr(7);
							arrivalWaypoints.push(wp);
						}
					}
					if (arrival && arrival.commonLegs) {
						for (let i = 0; i < arrival.commonLegs.length; i++) {
							let wp = new WayPoint(this.instrument);
							wp.icao = arrival.commonLegs[i].fixIcao;
							wp.ident = wp.icao.substr(7);
							arrivalWaypoints.push(wp);
						}
					}
					let runwayTransition = arrival.runwayTransitions[0];
					if (arrival.runwayTransitions.length > 0) {
					}
					if (runwayTransition && runwayTransition.legs) {
						for (let i = 0; i < runwayTransition.legs.length; i++) {
							let wp = new WayPoint(this.instrument);
							wp.icao = runwayTransition.legs[i].fixIcao;
							wp.ident = wp.icao.substr(7);
							arrivalWaypoints.push(wp);
						}
					}
				}
			}
		}
		return arrivalWaypoints;
	}

	getArrivalWaypointsMap() {
		let arrivalWaypoints = [];
		for (let i = this._waypoints[this._currentFlightPlanIndex].length - 1 - this._arrivalWaypointSize; i < this._waypoints[this._currentFlightPlanIndex].length - 1; i++) {
			arrivalWaypoints.push(this._waypoints[this._currentFlightPlanIndex][i]);
		}
		return arrivalWaypoints;
	}

	getWaypointsWithAltitudeConstraints() {
		let waypointsWithAltitudeConstraints = [];
		for (let i = 0; i < this._waypoints[0].length; i++) {
			let wp = this._waypoints[0][i];
			if (wp.ident != '' && wp.legAltitudeDescription >= 1 && wp.legAltitude1 < 20000) {
				waypointsWithAltitudeConstraints.push(wp);
			}
		}
		let approachWaypoints = this.getApproachWaypoints();
		for (let i = 0; i < approachWaypoints.length; i++) {
			let apprWp = approachWaypoints[i];
			if (apprWp.ident != '' && apprWp.legAltitudeDescription >= 1 && apprWp.legAltitude1 < 20000) {
				waypointsWithAltitudeConstraints.push(apprWp);
			}
		}
		return waypointsWithAltitudeConstraints;
	}

	setDestination(icao, callback = () => {
	}, useLocalVars = false) {
		Coherent.call('SET_DESTINATION', icao, useLocalVars && !SimVar.GetSimVarValue('L:Glasscockpits_FPLHaveDestination', 'boolean')).then(() => {
			if (useLocalVars) {
				SimVar.SetSimVarValue('L:Glasscockpits_FPLHaveDestination', 'boolean', 1);
			}
			this.updateFlightPlan(callback);
		});
	}

	addWaypoint(icao, index = Infinity, callback = () => {
	}, setActive = true) {
		if (index === Infinity) {
			index = this._waypoints.length;
		}
		Coherent.call('ADD_WAYPOINT', icao, index, setActive).then(() => {
			this.updateFlightPlan(callback);
		});
	}

	setWaypointAltitude(altitude, index, callback = () => {
	}) {
		Coherent.call('SET_WAYPOINT_ALTITUDE', altitude, index).then(() => {
			this.updateFlightPlan(callback);
		});
	}

	setWaypointAdditionalData(index, key, value, callback = () => {
	}) {
		Coherent.call('SET_WAYPOINT_ADDITIONAL_DATA', index, key, value).then(() => {
			this.updateFlightPlan(callback);
		});
	}

	getWaypointAdditionalData(index, key, callback = () => {
	}) {
		Coherent.call('GET_WAYPOINT_ADDITIONAL_DATA', index, key).then((value) => {
			callback(value);
		});
	}

	invertActiveFlightPlan(callback = () => {
	}) {
		Coherent.call('INVERT_ACTIVE_FLIGHT_PLAN').then(() => {
			this.updateFlightPlan(callback);
		});
	}

	getApproachIfIcao(callback = () => {
	}) {
		Coherent.call('GET_IF_ICAO').then((value) => {
			callback(value);
		});
	}

	addFlightPlanUpdateCallback(_callback) {
		this._onFlightPlanUpdateCallbacks.push(_callback);
	}

	addWaypointByIdent(ident, index = Infinity, callback = EmptyCallback.Void) {
		SimVar.SetSimVarValue('C:fs9gps:IcaoSearchStartCursor', 'string', 'WANV', 'FMC').then(() => {
			this.instrument.requestCall(() => {
				SimVar.SetSimVarValue('C:fs9gps:IcaoSearchEnterChar', 'string', ident, 'FMC').then(() => {
					SimVar.SetSimVarValue('C:fs9gps:IcaoSearchMatchedIcao', 'number', 0, 'FMC').then(() => {
						let icao = SimVar.GetSimVarValue('C:fs9gps:IcaoSearchCurrentIcao', 'string', 'FMC');
						this.addWaypoint(icao, index, callback);
					});
				});
			});
		});
	}

	removeWaypoint(index, thenSetActive = false, callback = () => {
	}) {
		if (index == 0 && SimVar.GetSimVarValue('L:Glasscockpits_FPLHaveOrigin', 'boolean')) {
			Coherent.call('REMOVE_ORIGIN', index, thenSetActive).then(() => {
				SimVar.SetSimVarValue('L:Glasscockpits_FPLHaveOrigin', 'boolean', 0);
				this.updateFlightPlan(callback);
			});
		} else if (index == this.getWaypointsCount() - 1 && SimVar.GetSimVarValue('L:Glasscockpits_FPLHaveDestination', 'boolean')) {
			Coherent.call('REMOVE_DESTINATION', index, thenSetActive).then(() => {
				SimVar.SetSimVarValue('L:Glasscockpits_FPLHaveDestination', 'boolean', 0);
				this.updateFlightPlan(() => {
					this.updateCurrentApproach(() => {
						callback();
					});
				});
			});
		} else {
			Coherent.call('REMOVE_WAYPOINT', index, thenSetActive).then(() => {
				this.updateFlightPlan(() => {
					let prev = this.getWaypoint(index - 1);
					if (prev && prev.infos) {
						prev.infos.airwayOut = undefined;
					}
					let next = this.getWaypoint(index + 1);
					if (next && next.infos) {
						next.infos.airwayIn = undefined;
					}
					this.updateCurrentApproach(() => {
						callback();
					});
				});
			});
		}
	}

	indexOfWaypoint(waypoint) {
		return this._waypoints[this._currentFlightPlanIndex].indexOf(waypoint);
	}

	getWaypointsCount(flightPlanIndex = NaN) {
		if (isNaN(flightPlanIndex)) {
			flightPlanIndex = this._currentFlightPlanIndex;
		}
		if (this._waypoints && this._waypoints[flightPlanIndex]) {
			return this._waypoints[flightPlanIndex].length;
		}
		return 0;
	}

	getDepartureWaypointsCount() {
		return this._departureWaypointSize;
	}

	getArrivalWaypointsCount() {
		return this._arrivalWaypointSize;
	}

	getWaypoint(i, flightPlanIndex = NaN, considerApproachWaypoints) {
		if (isNaN(flightPlanIndex)) {
			flightPlanIndex = this._currentFlightPlanIndex;
		}
		if (!considerApproachWaypoints || i < this.getWaypointsCount() - 1) {
			return this._waypoints[flightPlanIndex][i];
		} else {
			let approachWaypoints = this.getApproachWaypoints();
			let apprWp = approachWaypoints[i - (this.getWaypointsCount() - 1)];
			if (apprWp) {
				return apprWp;
			}
			return this.getDestination();
		}
	}

	getWaypoints(flightPlanIndex = NaN) {
		if (isNaN(flightPlanIndex)) {
			flightPlanIndex = this._currentFlightPlanIndex;
		}
		return this._waypoints[flightPlanIndex];
	}

	getDepartureRunwayIndex() {
		return this._departureRunwayIndex;
	}

	getDepartureRunway() {
		let origin = this.getOrigin();
		if (origin) {
			let departure = this.getDeparture();
			let infos = origin.infos;
			if (infos instanceof AirportInfo) {
				if (departure) {
					if (departure.runwayTransitions[this.getDepartureRunwayIndex()]) {
						let depRunway = departure.runwayTransitions[this.getDepartureRunwayIndex()].name.replace('RW', '');
						let runway = infos.oneWayRunways.find(r => {
							return r.designation.indexOf(depRunway) !== -1;
						});
						if (runway) {
							return runway;
						}
					}
					return undefined;
				}
				if (this._runwayIndex >= 0) {
					return infos.oneWayRunways[this._runwayIndex];
				}
			}
		}
	}

	getDetectedCurrentRunway() {
		let origin = this.getOrigin();
		if (origin && origin.infos instanceof AirportInfo) {
			let runways = origin.infos.oneWayRunways;
			if (runways && runways.length > 0) {
				let direction = Simplane.getHeadingMagnetic();
				let bestRunway = runways[0];
				let bestDeltaAngle = Math.abs(Avionics.Utils.angleDiff(direction, bestRunway.direction));
				for (let i = 1; i < runways.length; i++) {
					let deltaAngle = Math.abs(Avionics.Utils.angleDiff(direction, runways[i].direction));
					if (deltaAngle < bestDeltaAngle) {
						bestDeltaAngle = deltaAngle;
						bestRunway = runways[i];
					}
				}
				return bestRunway;
			}
		}
		return undefined;
	}

	getDepartureProcIndex() {
		return this._departureProcIndex;
	}

	setDepartureProcIndex(index, callback = () => {
	}) {
		Coherent.call('SET_DEPARTURE_PROC_INDEX', index).then(() => {
			this.updateFlightPlan(callback);
		});
	}

	setDepartureRunwayIndex(index, callback = EmptyCallback.Void) {
		Coherent.call('SET_DEPARTURE_RUNWAY_INDEX', index).then(() => {
			this.updateFlightPlan(callback);
		});
	}

	setOriginRunwayIndex(index, callback = EmptyCallback.Void) {
		Coherent.call('SET_ORIGIN_RUNWAY_INDEX', index).then(() => {
			this.updateFlightPlan(callback);
		});
	}

	getDepartureEnRouteTransitionIndex() {
		return this._departureEnRouteTransitionIndex;
	}

	setDepartureEnRouteTransitionIndex(index, callback = EmptyCallback.Void) {
		Coherent.call('SET_DEPARTURE_ENROUTE_TRANSITION_INDEX', index).then(() => {
			this.updateFlightPlan(callback);
		});
	}

	getDepartureDiscontinuity() {
		return this._departureDiscontinuity;
	}

	clearDepartureDiscontinuity(callback = EmptyCallback.Void) {
		Coherent.call('CLEAR_DEPARTURE_DISCONTINUITY').then(() => {
			this.updateFlightPlan(callback);
		});
	}

	removeDeparture(callback = () => {
	}) {
		Coherent.call('REMOVE_DEPARTURE_PROC').then(() => {
			this.updateFlightPlan(callback);
		});
	}

	getArrivalProcIndex() {
		return this._arrivalProcIndex;
	}

	getArrivalTransitionIndex() {
		return this._arrivalTransitionIndex;
	}

	setArrivalProcIndex(index, callback = () => {
	}) {
		Coherent.call('SET_ARRIVAL_PROC_INDEX', index).then(() => {
			this.updateFlightPlan(callback);
		});
	}

	getArrivalDiscontinuity() {
		return this._arrivalDiscontinuity;
	}

	clearArrivalDiscontinuity(callback = EmptyCallback.Void) {
		Coherent.call('CLEAR_ARRIVAL_DISCONTINUITY').then(() => {
			this.updateFlightPlan(callback);
		});
	}

	setArrivalEnRouteTransitionIndex(index, callback = () => {
	}) {
		Coherent.call('SET_ARRIVAL_ENROUTE_TRANSITION_INDEX', index).then(() => {
			this.updateFlightPlan(callback);
		});
	}

	setArrivalRunwayIndex(index, callback = () => {
	}) {
		Coherent.call('SET_ARRIVAL_RUNWAY_INDEX', index).then(() => {
			this.updateFlightPlan(callback);
		});
	}

	getApproachIndex() {
		return this._approachIndex;
	}

	setApproachIndex(index, callback = () => {
	}, transition = 0) {
		Coherent.call('SET_APPROACH_INDEX', index).then(() => {
			Coherent.call('SET_APPROACH_TRANSITION_INDEX', transition).then(() => {
				this.updateFlightPlan(() => {
					this.updateCurrentApproach(() => {
						callback();
					});
				});
			});
		});
		SimVar.SetSimVarValue('C:fs9gps:FlightPlanNewApproachAirport', 'string', this.getDestination().icao);
		SimVar.SetSimVarValue('C:fs9gps:FlightPlanNewApproachApproach', 'number', index);
		SimVar.SetSimVarValue('C:fs9gps:FlightPlanNewApproachTransition', 'number', transition);
		SimVar.SetSimVarValue('C:fs9gps:FlightPlanLoadApproach', 'number', 1);
	}

	isLoadedApproach(forceSimVarCall = false) {
		let doSimVarCall = false;
		let t = 0;
		if (forceSimVarCall || this._isLoadedApproach === undefined) {
			doSimVarCall = true;
		} else {
			t = performance.now();
			if (t - this._isLoadedApproachTimeLastSimVarCall > 1000) {
				doSimVarCall = true;
			}
		}
		if (doSimVarCall) {
			this._isLoadedApproach = SimVar.GetSimVarValue('C:fs9gps:FlightPlanIsLoadedApproach', 'Bool');
			this._isLoadedApproachTimeLastSimVarCall = t;
		}
		return this._isLoadedApproach;
	}

	isActiveApproach(forceSimVarCall = false) {
		let doSimVarCall = false;
		let t = 0;
		if (forceSimVarCall || this._isActiveApproach === undefined) {
			doSimVarCall = true;
		} else {
			t = performance.now();
			if (t - this._isActiveApproachTimeLastSimVarCall > 1000) {
				doSimVarCall = true;
			}
		}
		if (doSimVarCall) {
			this._isActiveApproach = SimVar.GetSimVarValue('C:fs9gps:FlightPlanIsActiveApproach', 'Bool');
			this._isActiveApproachTimeLastSimVarCall = t;
		}
		return this._isActiveApproach;
	}

	isApproachActivated() {
		return SimVar.GetSimVarValue('L:FLIGHT_PLAN_MANAGER_APPROACH_ACTIVATED', 'boolean');
	}

	activateApproach(callback = EmptyCallback.Void) {
		if (!this.isLoadedApproach()) {
			callback();
			return;
		}
		if (this.isActiveApproach()) {
			this._approachActivated = true;
			SimVar.SetSimVarValue('L:FLIGHT_PLAN_MANAGER_APPROACH_ACTIVATED', 'boolean', true);
			callback();
			return;
		}
		Coherent.call('ACTIVATE_APPROACH').then(() => {
			this._approachActivated = true;
			SimVar.SetSimVarValue('L:FLIGHT_PLAN_MANAGER_APPROACH_ACTIVATED', 'boolean', true);
			this.updateCurrentApproach(() => {
				callback();
			});
		});
	}

	deactivateApproach() {
		Coherent.call('DEACTIVATE_APPROACH').then(() => {
			this._approachActivated = false;
			SimVar.SetSimVarValue('L:FLIGHT_PLAN_MANAGER_APPROACH_ACTIVATED', 'boolean', false);
		});
	}

	tryAutoActivateApproach() {
		Coherent.call('TRY_AUTOACTIVATE_APPROACH').then(() => {
			this._approachActivated = this._approachActivated || this.isActiveApproach();
			SimVar.SetSimVarValue('L:FLIGHT_PLAN_MANAGER_APPROACH_ACTIVATED', 'boolean', this._approachActivated);
		});
	}

	getApproachActiveWaypointIndex() {
		return this._approachActivated ? this.getActiveWaypointIndex() : -1;
	}

	getApproach() {
		if (!this._approach) {
			this._approach = new Approach();
		}
		return this._approach;
	}

	getApproachNavFrequency() {
		if (this._approachIndex >= 0) {
			let destination = this.getDestination();
			if (destination && destination.infos instanceof AirportInfo) {
				let airportInfo = destination.infos;
				let approach = this.getApproach();
				if (approach.name.indexOf('ILS') !== -1) {
					let frequency = airportInfo.frequencies.find(f => {
						return f.name.replace('RW0', '').replace('RW', '').indexOf(approach.runway) !== -1;
					});
					if (frequency) {
						return frequency.mhValue;
					}
				} else {
					return approach.vorFrequency;
				}
			}
		}
		return NaN;
	}

	getApproachTransitionIndex() {
		return this._approachTransitionIndex;
	}

	getLastIndexBeforeApproach() {
		return this._lastIndexBeforeApproach;
	}

	getApproachRunway() {
		let destination = this.getDestination();
		if (destination) {
			let infos = destination.infos;
			if (infos instanceof AirportInfo) {
				let approach = infos.approaches[this._approachIndex];
				if (approach) {
					let runway = infos.oneWayRunways.find(r => {
						return r.designation.indexOf(approach.runway.replace(' ', '')) !== -1;
					});
					return runway;
				}
			}
		}
	}

	getApproachWaypoints() {
		return this._approachWaypoints;
		let waypoints = [];
		let airportApproach = this.getApproach();
		let transition;
		if (airportApproach) {
			let transitionIndex = this.getApproachTransitionIndex();
			transition = airportApproach.transitions[transitionIndex];
			if (!transition) {
				transition = airportApproach.transitions[0];
			}
		}
		if (airportApproach && transition) {
			for (let i = (this.getArrivalProcIndex() == -1 ? 0 : 1); i < transition.waypoints.length - 1; i++) {
				waypoints.push(transition.waypoints[i]);
			}
		}
		return waypoints;
	}

	setApproachTransitionIndex(index, callback = () => {
	}) {
		Coherent.call('SET_APPROACH_TRANSITION_INDEX', index).then(() => {
			this.updateFlightPlan(callback);
		});
	}

	removeArrival(callback = () => {
	}) {
		Coherent.call('REMOVE_ARRIVAL_PROC').then(() => {
			this.updateFlightPlan(callback);
		});
	}

	activateDirectTo(icao, callback = EmptyCallback.Void) {
		Coherent.call('ACTIVATE_DIRECT_TO', icao).then(() => {
			this.updateFlightPlan(callback);
		});
	}

	cancelDirectTo(callback = EmptyCallback.Void) {
		Coherent.call('CANCEL_DIRECT_TO').then(() => {
			this.updateFlightPlan(callback);
		});
	}

	getIsDirectTo() {
		return this._isDirectTo;
	}

	getDirectToTarget() {
		return this._directToTarget;
	}

	getDirecToOrigin() {
		return this._directToOrigin;
	}

	getCoordinatesHeadingAtDistanceAlongFlightPlan(distance) {
		let prevWaypoint = this.getPreviousActiveWaypoint();
		let nextWaypoint = this.getActiveWaypoint();
		if (prevWaypoint && nextWaypoint) {
			let planeCoordinates = new LatLong(SimVar.GetSimVarValue('PLANE LATITUDE', 'degree latitude'), SimVar.GetSimVarValue('PLANE LONGITUDE', 'degree longitude'));
			let a = Avionics.Utils.computeGreatCircleDistance(planeCoordinates, prevWaypoint.infos.coordinates);
			let b = Avionics.Utils.computeGreatCircleDistance(planeCoordinates, nextWaypoint.infos.coordinates);
			let f = a / (a + b);
			let dActiveLeg = (1 - f) * Avionics.Utils.computeGreatCircleDistance(prevWaypoint.infos.coordinates, nextWaypoint.infos.coordinates);
			if (distance <= dActiveLeg) {
				let ff = distance / dActiveLeg;
				let startLat = Avionics.Utils.lerpAngle(prevWaypoint.infos.lat, nextWaypoint.infos.lat, f);
				let startLong = Avionics.Utils.lerpAngle(prevWaypoint.infos.long, nextWaypoint.infos.long, f);
				let targetLat = Avionics.Utils.lerpAngle(startLat, nextWaypoint.infos.lat, ff);
				let targetLong = Avionics.Utils.lerpAngle(startLong, nextWaypoint.infos.long, ff);
				return {lla: new LatLong(targetLat, targetLong), heading: nextWaypoint.bearingInFP};
			}
			distance -= dActiveLeg;
			let index = this.getActiveWaypointIndex() + 1;
			let done = false;
			let currentLegLength = NaN;
			while (!done) {
				nextWaypoint = this.getWaypoint(index);
				prevWaypoint = this.getWaypoint(index - 1);
				if (nextWaypoint && prevWaypoint) {
					currentLegLength = Avionics.Utils.computeGreatCircleDistance(prevWaypoint.infos.coordinates, nextWaypoint.infos.coordinates);
					if (currentLegLength < distance) {
						distance -= currentLegLength;
						index++;
					} else {
						done = true;
					}
				} else {
					done = true;
				}
			}
			if (nextWaypoint && prevWaypoint && isFinite(currentLegLength)) {
				let ff = distance / currentLegLength;
				let targetLat = Avionics.Utils.lerpAngle(prevWaypoint.infos.lat, nextWaypoint.infos.lat, ff);
				let targetLong = Avionics.Utils.lerpAngle(prevWaypoint.infos.long, nextWaypoint.infos.long, ff);
				return {lla: new LatLong(targetLat, targetLong), heading: nextWaypoint.bearingInFP};
			}
			return {lla: new LatLong(this.getDestination().infos.coordinates), heading: 0};
		}
		return undefined;
	}

	getCoordinatesAtNMFromDestinationAlongFlightPlan(distance) {
		let allWaypoints = [...this.getWaypoints()];
		let last = allWaypoints.pop();
		allWaypoints.push(...this.getApproachWaypoints());
		allWaypoints.push(last);
		let destination = this.getDestination();
		if (destination) {
			let fromStartDistance = destination.cumulativeDistanceInFP - distance;
			let prevIndex;
			let prev;
			let next;
			for (let i = 0; i < allWaypoints.length - 1; i++) {
				prevIndex = i;
				prev = allWaypoints[i];
				next = allWaypoints[i + 1];
				if (prev.cumulativeDistanceInFP < fromStartDistance && next.cumulativeDistanceInFP > fromStartDistance) {
					break;
				}
			}
			let prevCD = prev.cumulativeDistanceInFP;
			let nextCD = next.cumulativeDistanceInFP;
			let d = (fromStartDistance - prevCD) / (nextCD - prevCD);
			let output = new LatLong();
			output.lat = Avionics.Utils.lerpAngle(prev.infos.coordinates.lat, next.infos.coordinates.lat, d);
			output.long = Avionics.Utils.lerpAngle(prev.infos.coordinates.long, next.infos.coordinates.long, d);
			return {
				lla: output,
				prevIndex: prevIndex
			};
		}
	}
}

//# sourceMappingURL=FlightPlanManager.js.map