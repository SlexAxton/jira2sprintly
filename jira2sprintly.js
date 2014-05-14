/* YOUR INFO HERE */

// Usually a 3 letter abbreviation that prefixes all your tickets
var jira_project = 'OMG';

// The location of your JIRA install. Used to find the api.
var jira_url = 'https://stuff.yourcompany.com/jira/';

// Log into JIRA and find a cookie on the response with the
// key of JSESSIONID - that's this. It'll expire after a while
// and you'll have to log in again and generate another one.
var jira_session_id = 'GRABTHISFROMTHEJIRACOOKIE';

var sprintly_email = 'you@email.com';
// Log into Sprint.ly and go to your profile to find the API key information
var sprintly_api_key = '09824foundontheprofilepage';
var sprintly_product_id = 9999;

// This is so we can assign people to the right stuff. If the mapping isn't here,
// it won't be assigned to anybody.
//
// Map the JIRA name (not displayname) to the sprint.ly ID number
//
// You can find all the people in your sprint.ly account with something like
// curl -u you@email.com:API_KEY https://sprint.ly/api/products/{prod_num}/people.json

var people_map = {
  //"bobama" : 1234
};

/* MORE CUSTOMIZATIONS */

// How many issues to grab at once
var chunk_size = 100;

// Where to start. Dunno why it wouldn't be zero
var issue_start = 0;

// Time between sequential requests to the JIRA API
var jira_api_backoff_ms = 5;

// For some fields in greenhopper they're custom responses
// I don't know if these are the same for everyone, so you can
// change them here.
var jira_implementer_custom_id = 'customfield_10001';
var jira_global_rank_id = 'customfield_10225';
var jira_rank_id = 'customfield_10226';
var jira_story_points = 'customfield_10223';







/* PROBABLY (HOPEFULLY) WONT NEED TO EDIT _MUCH_
 * BELOW HERE BUT YOU PROBABLY WILL :/
 * -------------------------------------------------- */



var request = require('request');
var _ = require('underscore');

// Handle auth setup via cookie
// add additional cookies to jar as needed
var cookie = request.cookie('JSESSIONID=' + jira_session_id);
var jar = request.jar();
jar.add(cookie);
// add additional cookies to jar as needed
var cookie = request.cookie('00000000000');
jar.add(cookie);




/**
 * retrieveIssueList
 *
 * This will hit the JIRA API and get a shallow list of the issues
 * in the configured project.
**/
function retrieveIssueList (start, limit, cb, chunks) {
  // Build up responses
  chunks = chunks || [];

  // Make a request
  request({
    url : jira_url +
            'rest/api/2/search?jql=' +
            encodeURIComponent('project=' + jira_project) +
            '&maxResults='+limit+'&startAt='+start,
    jar : jar
  }, function (err, resp, body) {
    var res;


    // Catch network error
    if (err) {
      throw err;
    }

    // Shitty response codes
    if (resp.statusCode !== 200) {
      throw new Error('Not a good response code, dawg: ' + resp.statusCode + '\nProbz wanna check your urls and session stuff.');
    }

    // Try to parse the response
    try {
      res = JSON.parse(body);
    }
    // Let them know about invalid input/responses
    catch (e) {
      throw new Error('Invalid response from the server. Check your Session ID and URL.\nResponse:\n' + body);
    }

    // Make sure we have issues
    if (!res || !res.issues || !res.issues.length) {
      throw new Error('Weird reponse: No issues found. Response: \n' + body);
    }

    // Merge other issues
    chunks = _.union(chunks, res.issues);

    // Check for more issues
    if ((res.startAt + res.maxResults) < res.total) {
      return retrieveIssueList(start+limit, limit, cb, chunks);
    }

    // Return chunks so far
    return (cb || function(){})(err, chunks);
  });
}

/**
 * retrieveIssue
 *
 * This will hit the JIRA API and get a specific issue
 * back. This has the detailed information.
**/
function retrieveIssue (url, cb) {
  request({
    url : url,
    jar : jar
  }, function (err, resp, body) {
    var res;

    // Don't bust on an error, just pass back to be handled
    if (err) {
      return cb(err);
    }

    // Status Codes
    if (resp.statusCode !== 200) {
      return cb("Bad Response Code: " + resp.statusCode);
    }

    try {
      res = JSON.parse(body);
    }
    catch (e) {
      return cb(e);
    }
    (cb || function(){})(err, res);
  });
}

/**
 * translateJIRAIssue
 *
 * This function will take a raw response from the api
 * and turn it into something a touch more pleasant to
 * deal with.
**/
function translateJIRAIssue (issue) {
  // Gotta exist yo.
  if (!issue) {
    console.log('> invalid issue found.');
    return {};
  }

  // I hate typing.
  var f = issue.fields;
  // Build a nicer reponse object - adjust if necessary!
  var out = {
    key : issue.key,
    summary : f.summary,
	description : f.description,
	created : f.created,
	updated : f.updated,
	status : f.status.name,
	statuscategory : f.status.statusCategory.name,
	parent : f.parent ? f.parent.value ? f.parent.value.issueKey : null : null,
	fixversion : f.fixVersions &&  f.fixVersions.length > 0 ? f.fixVersions[0].name: '',
	labels : f.labels.value,
	type : f.issuetype.name,
	assignee : f.assignee ? f.assignee.name : '',
	priority : f.priority ? f.priority.name : '',
	reporter : f.reporter ? f.reporter.name : '',
	comments : f.comment && f.comment.total >0 ? f.comment.comments : '' ,
	reporter : f.reporter ? f.reporter.value.name : ''
	//custom - use if needed!
	//    global_rank : f[jira_global_rank_id].value,
	//    rank : f[jira_rank_id].value,
	//implementer : f[jira_implementer_custom_id].value ? f[jira_implementer_custom_id].value.key : null,
	
  };
  return out;
}

/**
 * createHierarchy
 *
 * This function will take an object of issues (key is issue name)
 * and turn it into a story/task hierarchy. So tasks that have a parent
 * will only be listed as children of
 *
**/
function createHierarchy (issues) {
  var stories = {};
  var tasks = [];
  _(issues).forEach(function (issue) {
    // Don't worry about children yet
    if (issue.parent) {
      tasks.push(issue);
      return;
    }

    // Mark as a story
    issue.story = true;
    issue.children = [];
    // Put the stories as the base
    stories[issue.key] = issue;
  });

  tasks.forEach(function (task) {
    var parent = stories[task.parent];

    // "Handle" shitty case
    if (!parent) {
      console.log(task.key, task.parent, issues[task.parent]);
      throw new Error('> Child task with no parent found!! Yipes: ' + task.parent);
    }

    // Attach child to parent
    parent.children.push(task);
  });

  return stories;
}

function prettyPrint (stories, level) {
  // Base case
  if (!stories || _(stories).isEmpty()) {
    return;
  }

  // Set our print prefixes
  level = level || 0;
  var prefix = "";

  // Build up our prefix
  for (var i = 0; i < level; i++) {
    prefix += '--';
  }

  if (level) {
    prefix += ' ';
  }

  // Loop through the stories and output their names
  _(stories).forEach(function (story) {
    console.log(prefix + story.key);
    prettyPrint(story.children, level+1);
  });
}


function getSprintlyPeople (cb) {
  cb = cb || function(){};

  // Request the people url for the sprintly project
  request(
    'https://' + encodeURIComponent(sprintly_email) + ':' + sprintly_api_key +
    '@sprint.ly/api/products/' + sprintly_product_id + '/people.json',
  function (err, resp, body) {
    if (err) {
      return cb(err);
    }

    if (resp.statusCode !== 200) {
      return cb(new Error("Bad Status Code while retrieving people: " + resp.statusCode));
    }

    var people;
    var peopleMap = {};
    try {
      people = JSON.parse(body);
    }
    catch (e) {
      return cb(e);
    }

    people.forEach(function (person) {
      peopleMap[person.id] = person;
    });

    // Switch out the ids in the global people map
    // with the full objects
    _(people_map).forEach(function (id, jira_name) {
      people_map[jira_name] = peopleMap[id];
    });

    cb(err, people_map);
  });
}


function translate_size (size) {
  if (!size) {
    return '~';
  }
  else if (size <= 5) {
    return 'S';
  }
  else if (size <= 13) {
    return 'M';
  }
  else if (size <= 20) {
    return 'L';
  }
  return 'XL';
}

function translate_status (status) {
  if (!status) {
    return 'backlog';
  }
  status = status.toLowerCase();

  if (status === 'closed') {
    return 'accepted';
  }
  else if (
    status === 'open' ||
    status === 'in progress' ||
    status === 'reopened'
  ) {
    return 'in-progress';
  }
  else if (status === 'resolved') {
    return 'completed';
  }
  return 'backlog';
}

var queue_started = false;
var comment_queue_started = false;
var sprintly_queue = [];
var sprintly_comment_queue = [];

function postSprintlyQueue() {
  var sp = sprintly_queue.shift();
  var data = sp.data;
  var story = sp.story;
  var parent_id = sp.parent_id;

  // Post our itme
  console.log('> #' + story.key + ' started');
  request.post({
    url : 'https://' + encodeURIComponent(sprintly_email) + ':' + sprintly_api_key +
      '@sprint.ly/api/products/' + sprintly_product_id + '/items.json',
    form : data
  }, function (e, resp, body) {
    console.log('> #' + story.key + ' completed');

    // Even the 500 errors come back as JSON,
    // so I'm being brave here
    var stResp = JSON.parse(body);

    // Make sure our responses are lovely.
    if (resp.statusCode !== 200) {
      console.log('! Error adding ' + story.key + ' to sprint.ly');
      console.log(body);
      return;
    }

    // Log out activity
    console.log((parent_id ? '>' : '') +
                '> Added ' + story.key +
                ' as #' + stResp.number +
                (parent_id ? ' child of #' + parent_id : '')
    );

    // If the story has children, add them to the front of the queue
    if (story.children.length && stResp.number) {
      console.log('> Posting children for #' + stResp.number);
      addIssuesToSprintly(story.children, people_map, stResp.number);
    }

    if (story.comments && story.comments.length && stResp.number) {
      addCommentsToSprintly(story.comments, people_map, stResp.number);
    }

    // If there's still more in the queue, call this again
    // Essentially, run this function until we can't.
    if (sprintly_queue.length) {
      postSprintlyQueue();
    }
    else {
      // For the race condition where we deplete the queue,
      // but stuff still get's added later
      queue_started = false;
    }
  });
}

function postSprintlyCommentQueue() {
  var sp = sprintly_comment_queue.shift();
  var data = sp.data;
  var story_id = sp.story_id;

  // Post our itme
  console.log('> Comment for #' + story_id + ' started');
  request.post({
    url : 'https://' + encodeURIComponent(sprintly_email) + ':' + sprintly_api_key +
      '@sprint.ly/api/products/' + sprintly_product_id + '/items/' + story_id + '/comments.json',
    form : data
  }, function (e, resp, body) {
    console.log('> Comment for #' + story_id + ' completed');

    // Even the 500 errors come back as JSON,
    // so I'm being brave here
    var stResp = JSON.parse(body);

    // Make sure our responses are lovely.
    if (resp.statusCode !== 200) {
      console.log('! Error adding comment for ' + story_id + ' to sprint.ly');
      console.log(body);
      return;
    }

    // Log out activity
    console.log('> Added comment for ' + story_id);

     // If there's still more in the queue, call this again
    // Essentially, run this function until we can't.
    if (sprintly_comment_queue.length) {
      postSprintlyCommentQueue();
    }
    else {
      // For the race condition where we deplete the queue,
      // but stuff still get's added later
      comment_queue_started = false;
    }
  });
}

function pushToSprintlyQueue (story, data, parent_id) {
  sprintly_queue.push({story:story, data:data, parent_id: parent_id});

  // This means it was down to zero
  // though I'm sure a race condition exists
  if (!queue_started) {
    queue_started = true;
    postSprintlyQueue();
  }
}

function pushToSprintlyCommentQueue (comment, data, story_id) {
  sprintly_comment_queue.push({comment:comment, data:data, story_id: story_id});

  // This means it was down to zero
  // though I'm sure a race condition exists
  if (!comment_queue_started) {
    comment_queue_started = true;
    postSprintlyCommentQueue();
  }
}

/* Sprint.ly POST item API
*
type (string, required): What kind of item you'd like to create. Only story, task, defect, and test are valid values.
title (string, required for task, defect, and test) The title of item.
who (string, required for story) The who part of the story.
what (string, required for story) The what part of the story.
why (string, required for story) The why part of the story.
description (string) A description detailing the item. Markdown is allowed.
score (string) The initial score of the document. Only ~, S, M, L, and XL are valid values.
status (string): Status of the new item. Default is backlog. Only backlog, in-progress, completed, and accepted are valid values.
assigned_to (integer) The user's id which the item should assigned to.
tags (string) A comma separated list of tags to assign to the item (e.g. foo,bar,some other tag,baz).
*/
function addIssuesToSprintly (stories, people, parent_id) {

  // initialize our throttling
  var delay = 0;


  // Sort the stories by rank, so they get submitted that way
  stories = _(stories).sortBy(function (story) {
    return story.rank || Infinity;
  });

  // Go through each top level item and add it in
  _(stories).forEach(function (story) {
    // Just in case we don't have any kids.
    story.children = story.children || [];

    // Let's only add stories without children for now
    var person = people[story.assignee] || {};

    // Create a base data object
    // for the item
    var data = {
      description : story.description,
      score : translate_size(story.size),
      status : translate_status(story.status),
      tags : 'priority: '+ story.priority +','+ 'type: ' + story.type + ','+ story.fixversion + ','+story.labels.join(',') + ','+story.versions.join(',')
    };
	
	
    if (parent_id) {
      data.parent = parent_id;
    }

    // Only add the assignee if they exist
    if (person.id) {
      data.assigned_to = person.id;
    }
    // If it's listed as a story, and isn't a child item
    if (story.children.length || (!parent_id && story.type.match(/story|epic/i))) {
      data.type = 'story';
      data.who  = 'developer';
      data.what = 'complete this story';
      data.why  = story.summary ? story.summary : 'Summary missing';
    }
    else if (story.type.match(/bug/i)) {
      data.type = 'defect';
      data.title = story.summary;
    }
    else if (story.type.match(/test/i)) {	
      data.type = 'test';
      data.title = story.summary;
    }
    else {		
      data.type = 'task';
      data.title = story.summary;
    }

    pushToSprintlyQueue(story, data, parent_id);
  });
}

function addCommentsToSprintly (comments, people, story_id) {

  // Go through each top level item and add it in
  _(comments).forEach(function (comment) {
    // Create a base data object
    // for the comment
    var data = {
      body : comment.author.displayName + ' wrote in JIRA:\n\n' + comment.body
    };

    pushToSprintlyCommentQueue(comment, data, story_id);
  });
}

function completeIssueRetrieval (failed, fullIssues) {
  var stories;

  // Let peeps know about failures
  if (failed.length) {
    console.log('! Warning: The following issues failed at least once: ' + failed.map(function (i) {
      return i.key;
    }).join(', '));
  }
  else {
    console.log('> All issues retrieved without failures.');
    // Generate an object that takes hierarchy into
    // consideration
    stories = createHierarchy(fullIssues);

    // Print out the structure for visual
    // niceness.
    prettyPrint(stories);

    // Reconcile more sprintly info with the people map
    getSprintlyPeople(function (e, people){
      if (e) {
        throw e;
      }

      // Let's add our hierarchy to sprint.ly
      addIssuesToSprintly(stories, people);
    });
  }
}

function handleIssueResponse (err, fullIssue, issue, issues, responses, failed, fullIssues) {
  var tIssue;

  // Handle error by just adding the issue into the failed list
  if (err) {
    console.log('! Trouble grabbing issue ' + issue.key + '\n>> ' + err);
    // Add the issue to the failed queue
    failed.push(issue);

    console.log('! Trying it again, though');
    retrieveIssue(issue.self, function (err, res) {
      handleIssueResponse(err, res, issue, issues, responses, failed, fullIssues);
    });
  }

  // A little helpful logging
  if (responses % 50 === 0) {
    console.log('> Retrieved ' + responses + '/' + issues.length + ' issues');
  }

  // Convert the issue to a more readable state
  // then add it to the full issue list
  tIssue = translateJIRAIssue(fullIssue);
  fullIssues[tIssue.key] = tIssue;

  // If we've gotten all responses including retries
  if (responses >= (issues.length + failed.length)) {
    completeIssueRetrieval(failed, fullIssues);
  }
}

// Run the app.
// Retrieve the list of issues, then retrieve each one.
retrieveIssueList(issue_start, chunk_size, function (err, issues) {
  // Chop into much smaller for testing
  // issues = issues.slice(0, 10);

  var failed = [];
  var fullIssues = {};
  var responses = 0;

  // ms wait between issue requests
  var curDelay = 0;


  // Go through each of the issues
  issues.forEach(function (issue, idx) {
    // Don't flood the JIRA servers, space each request
    setTimeout(function () {
      // Grab the issue
      retrieveIssue(issue.self, function (err, res) {
        // Incremement our response count
        responses++;
        handleIssueResponse(err, res, issue, issues, responses, failed, fullIssues);
      });
    }, curDelay);

    // Add to the delay
    curDelay += jira_api_backoff_ms;
  });
});


