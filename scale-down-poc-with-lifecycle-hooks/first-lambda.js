exports.handler = function(event, context) {

	//Importing AWS SDK for nodejs
	var AWS = require('aws-sdk');
	var sns = new AWS.SNS();

	var Client = require('node-rest-client').Client;

	var q = require("q");

	var options_auth = { user: "basic_auth_user", password: "basic_auth_password" }
	var client = new Client(options_auth);

	process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
	
	var ec2 = new AWS.EC2();

	var snsTopic = SNSTopicArn; //Put SNS topic ARN to trigger second lambda function

	var instanceData = JSON.parse(event.Records[0].Sns.Message);

	var selectedInstance = instanceData.EC2InstanceId;

	var params = {
	  InstanceIds: [		    
	    selectedInstance
	  ]
	};
	
	console.log(instanceData);

	return q.ninvoke(ec2, 'describeInstances', params)
	.then(function(data){
		console.log(data['Reservations'][0]['Instances'][0]['PrivateIpAddress']);

		var privateIpAddress = data['Reservations'][0]['Instances'][0]['PrivateIpAddress'];
	 
		return suspendInstance(client, privateIpAddress, instanceData)

	})
	.then(callSuspendStatus)
	.done();
		

	function suspendInstance(client, privateIpAddress, instanceData){

		var selectedInstance = instanceData.EC2InstanceId;
		var deferred = q.defer();
		var post_args = {
			headers: {"some_key": "my_key",
						"Content-Type": "application/json" },
			data: { "suspend_key" : "my_another_key",
					"hostname": privateIpAddress }				 
		}; // API call arguments to suspend all necessary processing

		console.log(post_args);

		//Enter your API endpoint here. Make sure your response is in JSON.
		client.post("https://myapp.com/suspend", post_args, function(data,response) {
			var status = data.toString(); 
			status = status.replace(/\\/g , "");
			status = status.replace(/^"(.*)"$/, '$1');
			statusData = JSON.parse(status);

			console.log(statusData);

			var suspendData = { 'privateIpAddress': privateIpAddress, 'selectedInstance': selectedInstance, 'statusData': statusData, 'instanceData': instanceData };
			deferred.resolve(suspendData);
		}).on('error',function(err){
			deferred.reject(err);
	        console.log('Something went wrong on the request', err.request.options);
		});
	    return deferred.promise;
	}

	function callSuspendStatus(suspendData){

		var message = JSON.stringify({ default: JSON.stringify({ instanceId: suspendData.selectedInstance, hostIP: suspendData.privateIpAddress, instanceData: suspendData.instanceData }) });

		var snsParams = {
			Message: message, 
			MessageStructure: 'json',
			TopicArn: snsTopic
	    };

	    console.log(message);

	    return q.ninvoke(sns, 'publish', snsParams)
	    .then(function(data){
	        console.log("Here is data: ", data);	       
	        return data;
	    })
	    .then(function(){
	        context.done();
	    })
	    .catch(function(error){
	        console.log(error);
	    })
	    .done();

	}

};
