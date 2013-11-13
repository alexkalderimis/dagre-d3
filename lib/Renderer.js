var layout = require('dagre').layout;

var d3;
try { d3 = require('d3'); } catch (_) { d3 = window.d3; }

module.exports = Renderer;

function Renderer() {
  this._layout = layout();
  this._getNodeLabel = defaultGetLabel;
  this._getEdgeLabel = defaultGetLabel;
  this._drawNode = defaultDrawNode;
  this._drawEdgeLabel = defaultDrawEdgeLabel;
  this._drawEdge = defaultDrawEdge;
  this._postLayout = defaultPostLayout;
  this._postRender = defaultPostRender;
  this._transition = defaultTransition;
  this._arrowToRoot = false;
}

Renderer.prototype.layout = function(layout) {
  if (!arguments.length) { return this._layout; }
  this._layout = layout;
  return this;
};

Renderer.prototype.arrowToRoot = function(arrowToRoot) {
  if (!arguments.length) { return this._arrowToRoot; }
  this._arrowToRoot = arrowToRoot;
  return this;
};

Renderer.prototype.drawNode = function(drawNode) {
  if (!arguments.length) { return bind(this._drawNode, this); }
  this._drawNode = drawNode;
  return this;
};

Renderer.prototype.drawEdgeLabel = function(drawEdgeLabel) {
  if (!arguments.length) { return bind(this._drawEdgeLabel, this); }
  this._drawEdgeLabel = drawEdgeLabel;
  return this;
};

Renderer.prototype.drawEdge = function(drawEdge) {
  if (!arguments.length) { return bind(this._drawEdge, this); }
  this._drawEdge = drawEdge;
  return this;
};

Renderer.prototype.postLayout = function(postLayout) {
  if (!arguments.length) { return bind(this._postLayout, this); }
  this._postLayout = postLayout;
  return this;
};

Renderer.prototype.getNodeLabel = function(getNodeLabel) {
  if (!arguments.length) { return bind(this._getNodeLabel, this); }
  this._getNodeLabel = getNodeLabel;
  return this;
};

Renderer.prototype.getEdgeLabel = function(getEdgeLabel) {
  if (!arguments.length) { return bind(this._getEdgeLabel, this); }
  this._getEdgeLabel = getEdgeLabel;
  return this;
};

Renderer.prototype.postRender = function(postRender) {
  if (!arguments.length) { return bind(this._postRender, this); }
  this._postRender = postRender;
  return this;
};

Renderer.prototype.graph = function(graph) {
  if (!arguments.length) { return this._graph; }
  this._graph = copyAndInitGraph(graph);
  return this;
};

Renderer.prototype.transition = function(transition) {
  if (!arguments.length) { return bind(this._transition, this); }
  this._transition = transition;
  return this;
};

Renderer.prototype.update = function (graph) {
  if (!arguments.length) { graph = this.graph(); }
  return render.call(this, graph, null);
};

Renderer.prototype.run = function(graph, svg) {
  if (arguments.length === 1 ) {
    svg = graph;
    graph = this.graph();
  } else {
    graph = copyAndInitGraph(graph);
  }
  if (!(graph && svg)) throw new Error("graph and svg are required");

  return render.call(this, graph, svg);
};

function render (graph, svg) {

  // Create node and edge roots, attach labels, and capture dimension
  // information for use with layout.
  var svgNodes = createNodeRoots.call(this, graph, svg);
  var svgEdges = createEdgeRoots.call(this, graph, svg);

  // Call main drawing routines in the context of this Renderer.
  drawNodes.call(this, graph, svgNodes);
  drawEdgeLabels.call(this, graph, svgEdges);
  
  // Now apply the layout function
  var result = runLayout.call(this, graph);

  var dimensions = getHeightAndWidth(result);
  // Run any user-specified post layout processing
  this._postLayout(result, svg);

  drawEdges.call(this, result, svgEdges, dimensions);

  // Apply the layout information to the graph
  reposition.call(this, result, svgNodes, svgEdges, dimensions);

  this._postRender(result, svg);

  return result;
}

/**
 * Copy the input graph so that it is not changed by the rendering
 * process.
 */
function copyAndInitGraph(graph) {
  if (!graph) throw new Error("graph is null");
  var copy = graph.copy();

  // Ensure all objects have a defined value.
  copy.nodes().forEach(function(u) {
    var value = copy.node(u);
    if (value === undefined) {
      value = {};
      copy.node(u, value);
    }
  });

  copy.edges().forEach(function(e) {
    var value = copy.edge(e);
    if (value === undefined) {
      value = {};
      copy.edge(e, value);
    }
  });

  return copy;
}

function createNodeRoots(graph, svg) {
  var roots = svg ? svg.selectAll('g.node') : this._nodeRoots;
  // Only include non-subgraph nodes
  var data = graph.nodes().filter(notComposite(graph));

  this._nodeRoots = roots.data(data);
  
  this._nodeRoots.enter()
             .append('g')
             .classed('node', true);
  this._nodeRoots.exit().remove();
  return this._nodeRoots;
}

function createEdgeRoots(graph, svg) {
  var roots = svg ? svg.selectAll('g.edge') : this._edgeRoots;
  var data = graph.edges();
  this._edgeRoots = roots.data(data);
  this._edgeRoots.enter().insert('g', '*').classed('edge', true);
  this._edgeRoots.exit().remove();
  return this._edgeRoots;
}

function drawNodes(graph, roots) {
  var renderer = this;

  roots
    .each(function(u) { renderer._drawNode(graph, u, d3.select(this)); })
    .each(function(u) { calculateDimensions(this, graph.node(u)); });
}

function drawEdgeLabels(graph, roots) {
  var renderer = this;
  var edgeLabelGs = roots.selectAll('g.edge-label-base').data(inheritData);
  edgeLabelGs.enter().append('g').attr('class', 'edge-label-base');
  edgeLabelGs
      .each(function(e) { renderer._drawEdgeLabel(graph, e, d3.select(this)); })
      .each(function(e) { calculateDimensions(this, graph.edge(e)); });
}

/**
 * Get the line renderer to use for this update.
 */
function getLine(layout, dimensions) {
  var getX, getY, rankDir = layout.rankDir();
  if ('BT' === rankDir) {
    getY = function (d) { return dimensions.y + dimensions.height - d.y; };
  } else {
    getY = function (d) { return d.y; };
  }
  if ('RL' === rankDir) {
    getX = function (d) { return dimensions.x + dimensions.width - d.x; };
  } else {
    getX = function (d) { return d.x; };
  }
  return d3.svg.line()
    .x(getX)
    .y(getY)
    .interpolate('bundle')
    .tension(0.95);
}

function drawEdges(graph, roots, dimensions) {
  var renderer = this;
  var line = getLine(this.layout(), dimensions);
  roots.each(function(e) { renderer._drawEdge(graph, e, d3.select(this), line); });
}

function calculateDimensions(group, value) {
  var bbox = group.getBBox();
  value.width = bbox.width;
  value.height = bbox.height;
}

function runLayout(graph) {
  var layout = this._layout;
  var rankDir = layout.rankDir();
  if ('RL' === rankDir) layout.rankDir('LR');
  var result = layout.run(graph);
  layout.rankDir(rankDir); // This is why mutation based apis are bad.

  // Copy labels to the result graph
  graph.eachNode(function(u, value) { result.node(u).label = value.label; });
  graph.eachEdge(function(e, u, v, value) { result.edge(e).label = value.label; });

  return result;
}

var defaultTransition = identity;

function getHeightAndWidth(graph) {
  var yPositions = graph.nodes().map(function (n) { return graph.node(n).y; });
  var xPositions = graph.nodes().map(function (n) { return graph.node(n).x; });
  var yExtent = d3.extent(yPositions);
  var height = yExtent[1] - yExtent[0];
  var xExtent = d3.extent(xPositions);
  var width = xExtent[1] - xExtent[0];
  return {x: xExtent[0], y: yExtent[0], height: height, width: width};
}

function reposition(graph, svgNodes, svgEdges, dimensions) {
  var rankDir = this.layout().rankDir();

  this._transition(svgNodes)
    .attr('transform', function(u) {
      var value = graph.node(u);
      if ('BT' === rankDir) {
        return 'translate(' + value.x + ',' + (dimensions.y + dimensions.height - value.y) + ')';
      } else if ('RL' === rankDir) {
        return 'translate(' + (dimensions.x + dimensions.width - value.x) + ',' + value.y + ')';
      } else {
        return 'translate(' + value.x + ',' + value.y + ')';
      }
    });

  this._transition(svgEdges)
    .selectAll('g .edge-label')
    .attr('transform', function(e) {
      var value = graph.edge(e);
      var point = findMidPoint(value.points);
      if ('BT' === rankDir) {
        return 'translate(' + point.x + ',' + (dimensions.y + dimensions.height - point.y) + ')';
      } else if ('RL' === rankDir) {
        return 'translate(' + (dimensions.x + dimensions.width - point.x) + ',' + point.y + ')';
      } else {
        return 'translate(' + point.x + ',' + point.y + ')';
      }
    });
}

function defaultDrawNode(graph, u, root) {
  // Rect has to be created before label so that it doesn't cover it!
  var renderer = this;
  var label = root.selectAll('g.label').data([u]);
  label.enter().append('g').attr('class', 'label');
  var content = renderer._getNodeLabel(graph.node(u));
  addLabel.call(renderer, content, label, 10, 10);
}

function defaultGetLabel (obj) {
  return (obj && obj.label) || '';
}

function defaultDrawEdgeLabel(graph, e, root) {
  var renderer = this;
  var label = root.selectAll('g.edge-label').data([e]);
  label.enter().append('g')
               .attr('class', 'edge-label');
  var labelContent = renderer._getEdgeLabel(graph.edge(e));
  addLabel.call(renderer, labelContent, label, 0, 0);
}

function defaultDrawEdge(graph, e, root, line) {
  var path = root.selectAll('path');
  if (path.empty()) {
    path = root.insert('path', '*').attr('marker-end', 'url(#arrowhead)');
  }
  var arrowToRoot = this._arrowToRoot;
  
  this._transition(path).attr('d', function() {
      var value = graph.edge(e);
      var source = graph.node(graph.incidentNodes(e)[0]);
      var target = graph.node(graph.incidentNodes(e)[1]);
      var points = value.points;

      var p0 = points.length === 0 ? target : points[0];
      var p1 = points.length === 0 ? source : points[points.length - 1];

      points.unshift(intersectRect(source, p0));
      // TODO: use bpodgursky's shortening algorithm here
      points.push(intersectRect(target, p1));
      if (arrowToRoot) points.reverse();

      return line(points);
    });
}

function defaultPostLayout() {
  // Do nothing
}

function defaultPostRender(graph, root) {
  if (!root) { return; } // Do not call on update.
  if (graph.isDirected() && root.select('#arrowhead').empty()) {
    root
      .append('svg:defs')
        .append('svg:marker')
          .attr('id', 'arrowhead')
          .attr('viewBox', '0 0 10 10')
          .attr('refX', 8)
          .attr('refY', 5)
          .attr('markerUnits', 'strokewidth')
          .attr('markerWidth', 8)
          .attr('markerHeight', 5)
          .attr('orient', 'auto')
          .attr('style', 'fill: #333')
          .append('svg:path')
            .attr('d', 'M 0 0 L 10 5 L 0 10 z');
  }
}

function addLabel(content, root, marginX, marginY) {
  // Add the rect first so that it appears behind the label
  var rect = root.selectAll('rect.label-bkg').data([content]);
  rect.enter().append('rect').attr('class', 'label-bkg');
  var labelSvg = root.selectAll('g.label-content').data([content]);
  labelSvg.enter().append('g').attr('class', 'label-content');

  if (content[0] === '<') {
    addForeignObjectLabel(content, labelSvg);
    // No margin for HTML elements
    marginX = marginY = 0;
  } else {
    addTextLabel(content, labelSvg);
  }

  var bbox = root.node().getBBox();
  var rbox = rect.node().getBBox();

  if (dimensionsAreEqual(bbox, rbox)) return;

  this._transition(labelSvg).attr('transform',
             'translate(' + (-bbox.width / 2) + ',' + (-bbox.height / 2) + ')');

  this._transition(rect)
    .attr('rx', 5)
    .attr('ry', 5)
    .attr('x', -(bbox.width / 2 + marginX))
    .attr('y', -(bbox.height / 2 + marginY))
    .attr('width', bbox.width + 2 * marginX)
    .attr('height', bbox.height + 2 * marginY);
}

function addForeignObjectLabel(label, root) {
  var fo = root
    .append('foreignObject')
      .attr('width', '100000');

  var w, h;
  fo
    .append('xhtml:div')
      .style('float', 'left')
      // TODO find a better way to get dimensions for foreignObjects...
      .html(function() { return label; })
      .each(function() {
        w = this.clientWidth;
        h = this.clientHeight;
      });

  fo
    .attr('width', w)
    .attr('height', h);
}

function addTextLabel(content, root) {
  var text = root.selectAll('text').data([content]);
  text.enter()
      .append('text')
      .attr('text-anchor', 'left');
  var span = text.selectAll('tspan').data([content]);
  span.enter().append('tspan').attr('dy', '1em');

  span.text(identity);
}

function identity (x) {
  return x;
}

function inheritData (x) {
  return [x];
}

function findMidPoint(points) {
  var midIdx = points.length / 2;
  if (points.length % 2) {
    return points[Math.floor(midIdx)];
  } else {
    var p0 = points[midIdx - 1];
    var p1 = points[midIdx];
    return {x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2};
  }
}

function intersectRect(rect, point) {
  var x = rect.x;
  var y = rect.y;

  // For now we only support rectangles

  // Rectangle intersection algorithm from:
  // http://math.stackexchange.com/questions/108113/find-edge-between-two-boxes
  var dx = point.x - x;
  var dy = point.y - y;
  var w = rect.width / 2;
  var h = rect.height / 2;

  var sx, sy;
  if (Math.abs(dy) * w > Math.abs(dx) * h) {
    // Intersection is top or bottom of rect.
    if (dy < 0) {
      h = -h;
    }
    sx = dy === 0 ? 0 : h * dx / dy;
    sy = h;
  } else {
    // Intersection is left or right of rect.
    if (dx < 0) {
      w = -w;
    }
    sx = w;
    sy = dx === 0 ? 0 : w * dy / dx;
  }

  return {x: x + sx, y: y + sy};
}

function notComposite(g) {
  return function (u) {
    return !('children' in g && g.children(u).length);
  };
}

function bind(f, ctx) {
  return function () { return f.apply(ctx, arguments); };
}

function dimensionsAreEqual(a, b) {
  return (a && b && a.height === b.height && a.width === b.width && a.y === b.y && a.x === b.x);
}

