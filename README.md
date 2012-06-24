# JIRA to sprint.ly

This is not a ready-to-go script, but it should get you 95% there.

* Create a test project in sprint.ly
* add all your users to that project
* fill out the info in the top of the script
* run, fix errors, repeat

I used this script to successfully transfer over 700 JIRA tickets (created via the greenhopper agile tool) to sprint.ly.

It is a tiny bit rough, but works around some of the kinks in each API.

Most of your editing should happen at the top, but I doubt I had enough variance to expect all the different configs.

You'll want to fill out your `user_map`, which is the mapping of jira `name` keys and sprintly user ids. This will make things nicer on the sprint.ly side.

Comments can't be posted on behalf of other users, so the user that is authed will be the creator of all comments, but they will indicate in the body who wrote them.

Pretty much any failure sets off a chain reaction of bad things happening, so I usually just kill the process as soon as something goes wrong. Comments not going through are usually ok to forget about, though... :/

Since sprint.ly needs you to wait for a response before you submit another task, the script can take a bit of time. It took about 30-45min for 700 tickets.
